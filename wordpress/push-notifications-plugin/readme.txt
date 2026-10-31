=== Push Notifications Plugin ===
Contributors: abhijitbose
Requires at least: 5.0
Requires PHP: 7.4
Stable tag: 1.3.0

Connect a WordPress website to your Push Notification project.

== Installation ==
1. Upload this ZIP through Plugins > Add New Plugin > Upload Plugin and activate it.
2. Open Settings > Push Notifications.
3. Copy API Base, Service URL, Domain Key, VAPID Public Key, and Sender API Key from the project's Configuration page.
4. Leave Service Worker Path empty. The plugin bundles and serves the worker automatically.
5. Save settings, visit the website, and click Enable notifications.
6. Send a test from WordPress settings or the project dashboard.

The backend API must be deployed at a public HTTPS address before installing on a live website. Localhost is only for local development. The sender key is used only in server requests and is never included in the browser script. You do not need to install the manual script as well.

Send on publish is optional and disabled for new installations. Delivery results mean the push service accepted the message; they do not confirm that a device displayed it. Larger subscriber lists need a background delivery queue on the backend.

== Changelog ==
= 1.3.0 =
* Report notification creation acknowledgements and unique clicks, including notification buttons.
* Mark WordPress sends in campaign reporting. Existing plugin settings are preserved.

= 1.2.0 =
Support banner images and up to two notification actions, including sharing and phone links. Replace the existing plugin and let subscribed browsers revisit to update their worker. Existing settings and subscriptions are preserved.

= 1.1.1 =
Fixes Windows ZIP path separators so Linux hosting extracts the plugin files into the correct folder.

= 1.1.0 =
Adds VAPID public-key configuration, an automatic bundled worker, authenticated domain-specific sends, and accurate send results.
