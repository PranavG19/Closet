// Expo entry point. Registers the composition root (src/App) as the RN root
// component. `expo.main` in package.json points here. Kept at the package root
// (the conventional Expo entry location) so the tooling finds it without config.
import { registerRootComponent } from 'expo';
import { App } from './src/App.js';

registerRootComponent(App);
