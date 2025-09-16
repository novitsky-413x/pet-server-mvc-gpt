const together = require('./together');

function buildUiCompressionPrompt(elements) {
    return [
        {
            role: 'system',
            content:
                'You compress raw DOM element records into a concise, stable UI map for automated test planning. Preserve semantics: roles, names, inputs, buttons, links, key actions. Keep selectors human-understandable (prefer id, name, text, or short CSS). Output strict JSON with fields: pages, components, actions. Do not include <think> in output.',
        },
        {
            role: 'user',
            content:
                'Given these UI elements (array of records) produce a compressed JSON describing actionable UI for testing. Limit to most relevant items, group similar. Elements: ' +
                JSON.stringify(elements).slice(0, 100_000),
        },
    ];
}

function buildTestCasePrompt({ url, title, uiMap, goals }) {
    const instruction = `Generate end-to-end UI test cases in clear, executable, human-readable steps. Use Gherkin-like style (Given/When/Then) but keep steps atomic and deterministic. Cover:
- happy paths for main flows
- field validations and error states
- negative cases (permissions, invalid input)
- navigation and links
- accessibility basics (focus, keyboard)
Represent each test as JSON: { title, priority, tags, preconditions, steps: [{index, action, selector, details, expected}], postconditions }. Use selectors from uiMap. Do not include <think>.`;
    return [
        { role: 'system', content: instruction },
        {
            role: 'user',
            content:
                'URL: ' + url +
                '\nTITLE: ' + (title || '') +
                '\nUI MAP: ' + JSON.stringify(uiMap).slice(0, 100_000) +
                '\nOPTIONAL GOALS: ' + (goals ? JSON.stringify(goals) : '[]') +
                '\nOutput: JSON with array tests.',
        },
    ];
}

async function summarizeUi(elements, { signal } = {}) {
    const messages = buildUiCompressionPrompt(elements);
    const { content } = await together.nonStreamingChat({ messages, signal });
    // try to parse JSON from the model output
    const firstBrace = content.indexOf('{');
    const firstBracket = content.indexOf('[');
    const start = firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
    let json = {};
    try {
        if (start >= 0) json = JSON.parse(content.slice(start));
    } catch (_) {
        json = { pages: [], components: [], actions: [] };
    }
    return json;
}

async function generateTestCases({ url, title, uiMap, goals, model, signal }) {
    const messages = buildTestCasePrompt({ url, title, uiMap, goals });
    const { content } = await together.nonStreamingChat({ messages, model, signal });
    let payload = { tests: [] };
    try {
        const start = content.indexOf('{');
        if (start >= 0) payload = JSON.parse(content.slice(start));
    } catch (_) {}
    return payload.tests || [];
}

module.exports = {
    summarizeUi,
    generateTestCases,
};

