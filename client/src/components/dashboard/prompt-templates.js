export const promptTemplates = [
  ['button', 'Floating button', 'A compact, persistent invitation.'],
  ['slide-in', 'Slide-in card', 'Explain the benefit before asking.'],
  ['dialog', 'Dialog Box', 'A compact invitation at the top of the page.'],
  ['modal', 'Central Modal', 'A centered card with a dismissible backdrop.'],
  ['fullscreen', 'Full Screen Pop Up', 'A full-page invitation with a clear way to decline.'],
  ['sticky', 'Sticky Bar', 'A vertical edge tab that opens your invitation.'],
];
export const promptTemplateName = value => promptTemplates.find(([key]) => key === value)?.[1] || 'Unknown template';
