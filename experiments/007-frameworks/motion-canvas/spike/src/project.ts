import {makeProject} from '@motion-canvas/core';
import demo from './scenes/demo?scene';
import heavy from './scenes/heavy?scene';

export default makeProject({
  scenes: [demo, heavy],
});
