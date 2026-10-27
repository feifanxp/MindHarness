import fs from 'fs';
import path from 'path';
import { assertElementCallTransparentBackground } from './element-call-background.mjs';

const elementCallIndexPath = path.resolve('dist/public/element-call/index.html');
const elementCallIndex = fs.readFileSync(elementCallIndexPath, 'utf8');

assertElementCallTransparentBackground(elementCallIndex);
