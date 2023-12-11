module.exports = {
  presets: [
    '@babel/preset-env',
    require.resolve('@docusaurus/core/lib/babel/preset'),
    ['@babel/preset-react', {runtime: 'automatic'}],
  ],
};
