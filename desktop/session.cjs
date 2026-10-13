const fs = require('node:fs');
const path = require('node:path');
function backupUnreadableSession(dir) {
  // Keep encrypted evidence outside the diagnostic export and retain settings.
  const suffix = '.unreadable-' + require('node:crypto').randomUUID() + '.enc';
  const moved = [];
  try {
    for (const name of ['session.enc', 'camera-names.enc']) {
      const original = path.join(dir, name), backup = original + suffix;
      if (fs.existsSync(original)) {fs.renameSync(original, backup); moved.push({original, backup});}
    }
  } catch (error) {
    for (const {original, backup} of moved.reverse()) fs.renameSync(backup, original);
    throw error;
  }
  return moved.map(item => item.backup);
}
module.exports = {backupUnreadableSession};
