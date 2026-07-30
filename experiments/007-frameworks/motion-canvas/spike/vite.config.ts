import {defineConfig} from 'vite';
import motionCanvas from '@motion-canvas/vite-plugin';

export default defineConfig({
  plugins: [motionCanvas({project: ['./src/project.ts']})],
  server: {port: 5199, strictPort: true},
});
