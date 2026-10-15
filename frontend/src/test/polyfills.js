// jsdom lacks these Node globals, which React Router 7 needs at import time.
const { TextDecoder, TextEncoder } = require('node:util');

Object.assign(global, { TextDecoder, TextEncoder });
