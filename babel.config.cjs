/**
 * Babel configuration for Jest.
 * This tells Jest how to transpile modern JavaScript (ES Modules) for testing.
 */
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
