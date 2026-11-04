import {paintDarkBase} from './content/prepaint';

// Registered by the service worker for top-level pages of every host that is
// not disabled, so the base is on the root before the document's first frame.
paintDarkBase();
