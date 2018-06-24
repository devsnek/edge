'use strict';

({ binding, namespace }) => {
  const {
    open, stat, fstat, read, close,
    O_RDONLY,
    /*
    O_WRONLY,
    O_RDWR,
    O_APPEND,
    O_SYNC,
    O_CREAT,
    O_TRUNC,
    O_EXCL,
    */
  } = binding('fs');

  namespace.readFile = async (path) => {
    let fd;
    try {
      fd = await open(path, O_RDONLY);
      const stats = await fstat(fd);
      const buffer = await read(fd, stats.size, -1);
      return buffer;
    } catch (e) {
      throw new Error(`${e.message}: "${path}"`);
    } finally {
      if (fd !== undefined) {
        await close(fd);
      }
    }
  };

  namespace.stat = (path) => stat(path);
};
