'use strict';

(process, binding, setCallbacks) => {
  Object.defineProperties(this, {
    global: {
      value: this,
      writable: true,
      enumerable: false,
      configurable: true,
    },
    environment: {
      value: new (class Environment {})(),
      enumerable: false,
      writable: false,
      configurable: false,
    },
  });

  const ZERO_VERSION = '0.0.1';
  process.versions.zero = ZERO_VERSION;

  const ZERO_HELP = `
  zero [OPTIONS] <entry>

  -h, --help      show list of command line options
  -v, --version   show version of zero
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
  utilBinding.previewEntries = (value) => {
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

  const onExit = () => {
    if (global.dispatchEvent !== undefined) {
      const e = new global.Event('exit', { cancelable: false });
      global.dispatchEvent(e);
    }
  };

  setCallbacks(onExit);

  const config = JSON.parse(natives['out/config']);

  const PrivateSymbol = config.exposePrivateSymbols ?
    Symbol :
    ScriptWrap.run('[NativeSyntax]', '(name) => %CreatePrivateSymbol(name);');

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

  const errors = load('errors');
  load('ffi'); // attaches to global

  let entryMode = 'module';
  let doEval = false;
  let pastFile = false;
  process.argv = process.argv.filter((a, i) => {
    if (i === 0) {
      process.argv0 = a;
      return false;
    }

    if (!pastFile) {
      if (a === '-h' || a === '--help') {
        debug.log(ZERO_HELP);
        process.exit(0);
      }

      if (a === '-v' || a === '--version') {
        debug.log(ZERO_VERSION);
        process.exit(0);
      }

      if (/--mode=/.test(a)) {
        entryMode = a.slice('--mode='.length);
        return false;
      }

      if (a === '-e' || a === '--eval') {
        doEval = true;
        return false;
      }

      if (/^-/.test(a)) {
        const e = new RangeError(`Invalid argument: ${a}`);
        e[errors.kNoErrorFormat] = true;
        throw e;
      } else {
        pastFile = true;
      }
    }

    return a;
  });

  global.environment.argv = process.argv;

  Object.defineProperties(global, {
    MIME: {
      value: load('mime').MIME,
      enumerable: false,
      configurable: true,
      writable: true,
    },
  });

  process.stdout = new TTYWrap(1);
  process.stderr = new TTYWrap(2);

  load('w3'); // attaches globals
  const { console } = load('whatwg'); // attaches globals
  const { Loader, attachLoaderGlobals } = load('loader');
  const { getURLFromFilePath, getFilePathFromURL, URL } = load('whatwg/url');

  if (!config.allowNativesSyntax) {
    setV8Flags('--no_allow_natives_syntax');
  }

  if (config.exposeBinding === true) {
    global.binding = binding;
  }

  const cwdURL = `${getURLFromFilePath(process.cwd)}/`;

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

  if (doEval) {
    if (entryMode === 'module') {
      loader.getModuleJob('[eval]')
        .then((job) => job.run())
        .then(({ result }) => console.log(result))
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
