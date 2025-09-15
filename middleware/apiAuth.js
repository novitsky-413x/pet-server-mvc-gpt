module.exports = (req, res, next) => {
    try {
        if (!req.session || !req.session.isLoggedIn || !req.user) {
            return res
                .status(401)
                .json({ error: { code: 'unauthorized', message: 'Authentication required' } });
        }
        next();
    } catch (err) {
        next(err);
    }
};
