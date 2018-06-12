'use strict';

(process, binding, setCallbacks) => {
  Object.defineProperties(this, {
    global: {
      value: this,
      writable: true,
      enumerable: false,
      configurable: true,
    },
    edge: {
      value: {},
      writable: true,
      enumerable: false,
      configurable: true,
    },
  });

  const EDGE_VERSION = '0.0.1';
  process.versions.edge = EDGE_VERSION;

  const EDGE_HELP = `
  edge [OPTIONS] <entry>

  -h, --help      show list of command line options
  -v, --version   show version of edge
  -e, --eval      evaluate module source from the current working directory
`;

  const ScriptWrap = binding('script_wrap');
  const natives = binding('natives');
  const debug = binding('debug');
  const { TTYWrap } = binding('tty');
  const utilBinding = binding('util');

  const {
    setV8Flags,
    previewEntries: _previewEntries,
  } = utilBinding;

  // patch previewEntries to property pair maps
  const previewEntries = utilBinding.previewEntries = (value) => {
    const [entries, isKeyed] = _previewEntries(value);
    if (isKeyed) {
      const len = entries.length / 2;
      const ret = new Array(len);
      for (let i = 0; i < len; i += 1) {
        ret[i] = [entries[2 * i], entries[(2 * i) + 1]];
      }
      return ret;
    }
    return entries;
  };

  const maybeUnhandledPromises = new WeakMap();
  let lastPromiseId = 0;

  // eslint bug thinks these are never re-assigned
  let console; // eslint-disable-line prefer-const

  const onUnhandledRejection = (promise, reason, handled) => {
    if (handled) {
      maybeUnhandledPromises.delete(promise);
    } else {
      lastPromiseId += 1;
      maybeUnhandledPromises.set(promise, {
        reason,
        id: lastPromiseId,
      });
    }
  };

  const onNextTick = () => {
    const entries = previewEntries(maybeUnhandledPromises);
    entries.forEach(([promise, { reason, id }]) => {
      maybeUnhandledPromises.delete(promise);
      const prefix = `[edge] Unhandled Rejection #${id}`;

      try {
        console.warn(`${prefix}: ${reason}`);
      } catch (e) {} // eslint-disable-line no-empty
    });
  };

  const onExit = () => {
    if (global.dispatchEvent !== undefined) {
      const e = new global.Event('exit', { cancelable: false });
      global.dispatchEvent(e);
    }
  };

  setCallbacks(onUnhandledRejection, onNextTick, onExit);

  const config = JSON.parse(natives.config);

  const { PrivateSymbol } = ScriptWrap.run('[NativeSyntax]', `
({
  PrivateSymbol: (name) => %CreatePrivateSymbol(name),
  __proto__: null,
});
`);

  const kCustomInspect = PrivateSymbol();

  const load = (specifier) => {
    if (load.cache[specifier] !== undefined) {
      return load.cache[specifier].namespace;
    }
    const source = natives[specifier];
    if (source === undefined) {
      throw new Error(`no such builtin: ${specifier}`);
    }
    const fn = ScriptWrap.run(specifier, source);
    const cache = load.cache[specifier] = {
      namespace: { __proto__: null },
      exports: undefined,
    };
    fn({
      namespace: cache.namespace,
      binding,
      load,
      process,
      PrivateSymbol,
      config,
      kCustomInspect,
    });
    cache.exports = Object.keys(cache.namespace);
    return cache.namespace;
  };
  load.cache = {};

  load('errors');
  load('ffi'); // attaches to global.edge

  const argv = process.argv = load('argparse').default(process.argv);
  process.argv0 = argv.shift();

  if (argv.v || argv.version) {
    debug.log(EDGE_VERSION);
    return;
  }

  if (argv.h || argv.help) {
    debug.log(EDGE_HELP);
    return;
  }

  process.stdout = new TTYWrap(1);
  process.stderr = new TTYWrap(2);

  load('w3'); // attaches globals
  ({ console } = load('whatwg')); // attaches globals
  const { Loader, attachLoaderGlobals } = load('loader');
  const { getURLFromFilePath, getFilePathFromURL, URL } = load('whatwg/url');

  if (!config.allowNativesSyntax) {
    setV8Flags('--no_allow_natives_syntax');
  }

  if (config.exposeBinding === true) {
    global.binding = binding;
  }

  const cwdURL = `${getURLFromFilePath(process.cwd)}/`;

  const entryMode = argv.mode || 'module';

  const loader = new Loader(cwdURL);
  attachLoaderGlobals(loader);

  const onError = (e) => {
    try {
      console.error(e);
    } catch (err) {
      process.stdout.write(`${e}\n`);
    } finally {
      process.exit(1);
    }
  };

  if (argv.e || argv.eval) {
    if (entryMode === 'module') {
      loader.getModuleJob('[eval]')
        .then((job) => job.run())
        .then(console.log)
        .catch(onError);
    } else {
      try {
        console.log(ScriptWrap.run('[eval]', process.argv[0]));
      } catch (err) {
        onError(err);
      }
    }
  } else if (process.argv[0]) {
    if (entryMode === 'module') {
      loader.import(process.argv[0]).catch(onError);
    } else if (entryMode === 'script') {
      const url = new URL(process.argv[0], cwdURL);
      const filename = getFilePathFromURL(url);
      load('fs').readFile(filename)
        .then((src) => ScriptWrap.run(url, src))
        .catch(onError);
    }
  } else {
    try {
      load('repl').start();
    } catch (err) {
      onError(err);
    }
  }
};