// Used only by Jest; Vite builds the app with its own pipeline.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
  plugins: ['babel-plugin-transform-vite-meta-env'],
};
