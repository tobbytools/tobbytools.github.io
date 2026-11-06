/* Privacy analytics config. Active collection: no.
   Nothing is sent while enabled is false or endpoint / websiteId are empty.
   Missing before collection can turn on (see ANALYTICS.md):
   - endpoint: https://gateway.umami.is/api/send
     Official Umami Cloud collect URL. Confirm it against current Umami docs
     before pasting it here. This file does not call that URL.
   - websiteId: the website UUID from your own Umami Cloud website settings.
     Do not paste an example id from Umami's documentation.
   - enabled: true, only after both values above are the real ones.
   Plausible is not a fit: hosted plans are a 30-day trial, then paid. */
window.TOBBY_ANALYTICS = {
  enabled: false,
  provider: "umami",
  endpoint: "",
  websiteId: ""
};
