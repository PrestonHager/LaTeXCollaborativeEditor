import { shouldConfirmLeave, unsavedReason, type LeaveState } from './leaveGuard';

const base: LeaveState = {
  reloadingForUpdate: false,
  unsavedEdits: false,
  savingPaused: false,
  provider: 'local',
  sessionWrite: 'full',
  saveFailed: false,
  heldConflicts: 0,
  filesInFlight: 0,
};

describe('shouldConfirmLeave', () => {
  it('stays quiet with nothing unsaved', () => {
    expect(shouldConfirmLeave(base)).toBe(false);
  });

  it('stays quiet for local edits the unload write kept (the old 4 second nag)', () => {
    expect(shouldConfirmLeave({ ...base, unsavedEdits: true })).toBe(false);
  });

  it('asks when local edits could not be written to this browser', () => {
    expect(unsavedReason({ ...base, unsavedEdits: true, sessionWrite: 'text-only' })).toBe('edits could not be kept in this browser');
    expect(shouldConfirmLeave({ ...base, unsavedEdits: true, sessionWrite: 'failed' })).toBe(true);
  });

  it('asks while saving is paused and there are edits', () => {
    expect(unsavedReason({ ...base, unsavedEdits: true, savingPaused: true })).toBe('saving is paused');
    expect(shouldConfirmLeave({ ...base, savingPaused: true })).toBe(false);
  });

  it('asks when edits have not reached Drive yet', () => {
    expect(unsavedReason({ ...base, unsavedEdits: true, provider: 'drive' })).toBe('edits are not saved to storage yet');
    expect(shouldConfirmLeave({ ...base, provider: 'drive' })).toBe(false);
  });

  it('asks after a failed save, for held conflicts, and for files in flight', () => {
    expect(unsavedReason({ ...base, saveFailed: true })).toBe('the last save failed');
    expect(unsavedReason({ ...base, heldConflicts: 1 })).toBe('files are waiting for you to pick a version');
    expect(unsavedReason({ ...base, filesInFlight: 2 })).toBe('files are still uploading or arriving');
  });

  it('never asks while reloading for an update', () => {
    expect(
      shouldConfirmLeave({ ...base, reloadingForUpdate: true, unsavedEdits: true, provider: 'drive', saveFailed: true, heldConflicts: 1 }),
    ).toBe(false);
  });
});
