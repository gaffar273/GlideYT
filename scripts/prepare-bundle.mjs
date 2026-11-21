import {mkdir} from 'node:fs/promises';
await mkdir(new URL('../.local/android/assets/', import.meta.url), {recursive: true});
