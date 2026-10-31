export const promptTemplates = [
  ['button', 'Floating button', 'A compact, persistent invitation.'],
  ['slide-in', 'Slide-in card', 'Explain the benefit before asking.'],
  ['dialog', 'Dialog Box', 'A compact invitation at the top of the page.'],
  ['modal', 'Central Modal', 'A centered card with a dismissible backdrop.'],
  ['fullscreen', 'Full Screen Pop Up', 'A full-page invitation with a clear way to decline.'],
  ['sticky', 'Sticky Bar', 'A vertical edge tab that opens your invitation.'],
];
export const mobilePromptTemplates = [
  ['native', 'Native Opt-in', 'A tap opens the browser permission prompt.'],
  ['dialog', 'Dialog Box', 'A compact invitation near the bottom.'],
  ['modal', 'Central Modal', 'A centered invitation with a backdrop.'],
  ['fullscreen', 'Fullscreen', 'A full-page invitation with a way to decline.'],
  ['header', 'Sticky Header', 'A compact invitation fixed to the top.'],
  ['slide-up', 'Slide-up Box', 'A panel that slides in from the bottom.'],
  ['sticky', 'Sticky Bar', 'A vertical tab that expands your invitation.'],
];
export const promptTemplateName = (value, device = 'large') => (device === 'mobile' ? mobilePromptTemplates : promptTemplates).find(([key]) => key === value)?.[1] || 'Unknown template';
