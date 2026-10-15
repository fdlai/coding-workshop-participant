// Loaded before every spec file.
import './commands';

// Each test starts signed out with a clean browser state.
beforeEach(() => {
  cy.clearLocalStorage();
});
