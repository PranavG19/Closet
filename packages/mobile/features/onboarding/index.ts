// Only the screen is public. intake.ts and stage.ts are internal to this feature (the same
// call features/laundry/index.ts makes about basket.ts): they are the screen's decision layer,
// and exporting them would invite a second caller to build its own upload path over them.
export * from './AddGarmentScreen.js';
