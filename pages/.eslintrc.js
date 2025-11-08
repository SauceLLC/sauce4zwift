const web = require('../.eslintrc-web.json');
module.exports.globals = {
    ...module.exports.globals,
    ...web.globals,
};
