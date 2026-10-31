import bcrypt from 'bcryptjs';

if (!process.stdin.isTTY || !process.stdin.setRawMode) {
  throw new Error('Run this command in an interactive terminal so the password is not echoed.');
}

/** @param {string} prompt */
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    /** @param {string} key */
    const onData = (key) => {
      if (key === '\u0003') {
        process.stdin.off('data', onData);
        process.stdin.setRawMode(false);
        reject(new Error('Cancelled.'));
      } else if (key === '\r' || key === '\n') {
        process.stdin.off('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(value);
      } else if (key === '\u007f' || key === '\b') {
        value = value.slice(0, -1);
      } else value += key;
    };
    process.stdin.on('data', onData);
  });
}

const password = await readHidden('Admin password (12+ characters): ');
if (password.length < 12) throw new Error('Use an admin password with at least 12 characters.');
console.log(await bcrypt.hash(password, 12));
