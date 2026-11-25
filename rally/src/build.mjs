// Inlines everything into one self-contained HTML file.
// Usage: node build.mjs   (run from rally/src)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

let three = read('vendor/three.min.js');
// drop the deprecation console.warn banner that ships with the UMD build
three = three.replace(/^console\.warn\([^\n]*\),\n/, 'void 0,\n');
if (three.includes('</script')) throw new Error('three.min.js contains </script');

const game = ['track.js', 'world.js', 'car.js', 'audio.js', 'game.js'].map(read).join('\n');
if (game.includes('</script')) throw new Error('game code contains </script');

const html = read('template.html')
  .replace('/*__THREE__*/', () => three)
  .replace('/*__GAME__*/', () => game);

if (/(?:src|href)\s*=\s*["']https?:/i.test(html)) throw new Error('external link found in HTML');
writeFileSync(join(here, '..', 'dune-warden.html'), html);
console.log('built dune-warden.html', (html.length / 1024).toFixed(0) + ' KB');
