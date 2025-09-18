const crypto = require('crypto');
const puppeteer = require('puppeteer');
const pako = require('pako');
const UiSnapshot = require('../models/UiSnapshot');

function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function toCssPath(element) {
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < 8) {
        let selector = node.nodeName.toLowerCase();
        const id = node.getAttribute('id');
        if (id) {
            selector += `#${CSS.escape(id)}`;
            parts.unshift(selector);
            break;
        }
        const className = (node.getAttribute('class') || '')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 3)
            .map((c) => `.${CSS.escape(c)}`)
            .join('');
        if (className) selector += className;
        let nth = 1;
        let sibling = node;
        while ((sibling = sibling.previousElementSibling)) {
            if (sibling.nodeName === node.nodeName) nth++;
        }
        if (nth > 1) selector += `:nth-of-type(${nth})`;
        parts.unshift(selector);
        node = node.parentElement;
    }
    return parts.join(' > ');
}

async function extractDomInfo(page) {
    return page.evaluate(() => {
        function visible(el) {
            const style = window.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity || '1') === 0)
                return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }

        function toXPath(el) {
            if (el.id) return `//*[@id="${el.id}"]`;
            const parts = [];
            while (el && el.nodeType === Node.ELEMENT_NODE) {
                let ix = 0;
                let sib = el.previousSibling;
                while (sib) {
                    if (sib.nodeType === Node.ELEMENT_NODE && sib.nodeName === el.nodeName) ix++;
                    sib = sib.previousSibling;
                }
                const tagName = el.nodeName.toLowerCase();
                const step = `${tagName}[${ix + 1}]`;
                parts.unshift(step);
                el = el.parentNode;
            }
            return '/' + parts.join('/');
        }

        function toRole(el) {
            const aria = el.getAttribute('role');
            if (aria) return aria;
            const tag = el.tagName.toLowerCase();
            if (tag === 'a' && el.hasAttribute('href')) return 'link';
            if (tag === 'button') return 'button';
            if (tag === 'input') {
                const type = (el.getAttribute('type') || 'text').toLowerCase();
                if (['button', 'submit', 'reset'].includes(type)) return 'button';
                if (type === 'checkbox') return 'checkbox';
                if (type === 'radio') return 'radio';
                return 'textbox';
            }
            if (tag === 'select') return 'combobox';
            if (tag === 'textarea') return 'textbox';
            return tag;
        }

        function getName(el) {
            // accessible name: aria-label > aria-labelledby > textContent
            const al = el.getAttribute('aria-label');
            if (al) return al.trim();
            const labelledBy = el.getAttribute('aria-labelledby');
            if (labelledBy) {
                const name = labelledBy
                    .split(/\s+/)
                    .map((id) => document.getElementById(id))
                    .filter(Boolean)
                    .map((n) => n.textContent || '')
                    .join(' ')
                    .trim();
                if (name) return name;
            }
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (text) return text;
            const placeholder = el.getAttribute('placeholder');
            if (placeholder) return placeholder.trim();
            return '';
        }

        function elementToRecord(el) {
            const rect = el.getBoundingClientRect();
            const record = {
                id: el.id || undefined,
                role: toRole(el),
                name: getName(el),
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute('type') || undefined,
                text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
                placeholder: el.getAttribute('placeholder') || undefined,
                href: el.getAttribute('href') || undefined,
                value: el.value || undefined,
                checked: el.checked || undefined,
                disabled: el.disabled || undefined,
                visible: visible(el),
                aria: Array.from(el.attributes)
                    .filter((a) => a.name.startsWith('aria-'))
                    .reduce((acc, a) => {
                        acc[a.name] = a.value;
                        return acc;
                    }, {}),
                attrs: Array.from(el.attributes)
                    .filter((a) => !a.name.startsWith('aria-'))
                    .reduce((acc, a) => {
                        acc[a.name] = a.value;
                        return acc;
                    }, {}),
                cssPath: (window.__cssPath || (() => ''))(el),
                xpath: toXPath(el),
                bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                children: [],
            };
            return record;
        }

        // Inject helper for css path from outer scope if present
        window.__cssPath = (el) => {
            const parts = [];
            let node = el;
            let depth = 0;
            while (node && node.nodeType === 1 && depth < 8) {
                let selector = node.nodeName.toLowerCase();
                const id = node.getAttribute('id');
                if (id) {
                    selector += `#${CSS.escape(id)}`;
                    parts.unshift(selector);
                    break;
                }
                const className = (node.getAttribute('class') || '')
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 3)
                    .map((c) => `.${CSS.escape(c)}`)
                    .join('');
                if (className) selector += className;
                let nth = 1;
                let sibling = node;
                while ((sibling = sibling.previousElementSibling)) {
                    if (sibling.nodeName === node.nodeName) nth++;
                }
                if (nth > 1) selector += `:nth-of-type(${nth})`;
                parts.unshift(selector);
                node = node.parentElement;
                depth++;
            }
            return parts.join(' > ');
        };

        function walk(root, limit = 1500) {
            const result = [];
            const stack = [root];
            while (stack.length && result.length < limit) {
                const el = stack.shift();
                if (!(el instanceof Element)) continue;
                const rec = elementToRecord(el);
                result.push(rec);
                const children = Array.from(el.children);
                for (const c of children) stack.push(c);
            }
            return result;
        }

        const elements = walk(document.body);
        return {
            title: document.title,
            url: location.href,
            elements,
            meta: {
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight,
                    devicePixelRatio: window.devicePixelRatio,
                },
            },
            html: document.documentElement.outerHTML,
        };
    });
}

async function scrapeUrlToSnapshot({ url, userId }) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    const raw = await extractDomInfo(page);
    const htmlHash = sha256(raw.html);
    delete raw.html;

    const json = JSON.stringify(raw);
    const compressedBlob = Buffer.from(pako.deflate(json));

    const snapshot = await UiSnapshot.create({
        userId: userId || undefined,
        url: raw.url,
        title: raw.title,
        htmlHash,
        meta: raw.meta,
        elements: raw.elements,
        compressed: true,
        compressedBlob,
    });

    await browser.close();
    return snapshot;
}

module.exports = {
    scrapeUrlToSnapshot,
};

