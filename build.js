'use strict';

const { rule, build } = require('./tools/bob');

const cflags = [
  '-Wall',
  '-std=c++1z',
  '-stdlib=libc++',
].join(' ');

const includes = [
  '-Ideps/v8/include',
  '-luv',
].join(' ');

const v8_deps = [
  'deps/v8/out.gn/x64.release/obj/libv8_monolith.a',
  'deps/v8/out.gn/x64.release/obj/third_party/icu/libicuuc.a',
  'deps/v8/out.gn/x64.release/obj/third_party/icu/libicui18n.a',
].join(' ');

rule('cc', {
  command: `g++ ${cflags} ${includes} ${v8_deps} {in} -o {out}`,
});

rule('blob2c', {
  command: 'python tools/blob2c.py {out} {in}',
});

build('out/ivan_blobs.cc', {
  rule: 'blob2c',
  dependencies: ['v8'],
  targets: [
    'lib/ivan.js',
    'lib/util.js',
    'lib/console.js',
    'lib/argparse.js',
    'lib/fs.js',
    'lib/loader.js',
    'lib/loader/translators.js',
    'lib/loader/module_job.js',
    'lib/loader/create_dynamic_module.js',
  ],
});

build('out/ivan', {
  rule: 'cc',
  dependencies: ['v8', 'out/ivan_blobs.cc'],
  targets: [
    'src/ivan.cc',
    'out/ivan_blobs.cc',
    'src/ivan_fs.cc',
    'src/ivan_module_wrap.cc',
    'src/ivan_platform.cc',
    'src/ivan_util.cc',
  ],
});


build('v8', {
  command: 'ninja -C deps/v8/out.gn/x64.release v8_monolith',
});
