<?php
// Contract checks for plugin integration without installing a WordPress instance.
define('ABSPATH', __DIR__);
$settings = [
    'api_base' => 'https://push.example.org', 'domain_key' => 'domain-key',
    'vapid_public_key' => 'public-vapid-key', 'api_key' => 'private-sender-key',
];
$inline_config = '';
$remote_request = [];
$response_status = 200;
$response_data = ['ok' => true, 'sent' => 0, 'message' => 'No subscribers yet.'];
function add_action(...$args) {}
function register_activation_hook(...$args) {}
function get_option($key, $default = []) { global $settings; return $settings; }
function wp_parse_args($saved, $defaults) { return array_merge($defaults, $saved); }
function wp_enqueue_script(...$args) {}
function trailingslashit($value) { return rtrim($value, '/') . '/'; }
function untrailingslashit($value) { return rtrim($value, '/'); }
function home_url($path = '/') { return 'https://website.test' . $path; }
function add_query_arg($key, $value, $url) { return $url . '?' . $key . '=' . $value; }
function wp_parse_url($value, $component) { return parse_url($value, $component); }
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
function wp_add_inline_script($handle, $value, $position) { global $inline_config; $inline_config = $value; }
function wp_remote_post($url, $args) { global $remote_request, $response_status, $response_data; $remote_request = ['url' => $url, 'args' => $args]; return ['status' => $response_status, 'body' => json_encode($response_data)]; }
function wp_remote_retrieve_response_code($response) { return $response['status']; }
function wp_remote_retrieve_body($response) { return $response['body']; }
class WP_Error { public $message; function __construct($code, $message) { $this->message = $message; } function get_error_message() { return $this->message; } }
function is_wp_error($value) { return $value instanceof WP_Error; }
function check_contract($value, $message) { if (!$value) { throw new Exception($message); } }

require __DIR__ . '/push-notifications-plugin/push-notifications.php';
$plugin = new Push_Notifications_Plugin();
$plugin->enqueue_frontend();
check_contract(strpos($inline_config, 'vapidPublicKey') !== false, 'VAPID public key is required.');
check_contract(strpos($inline_config, 'ttw_push_worker') !== false, 'Bundled worker URL is required.');
check_contract(strpos($inline_config, 'private-sender-key') === false, 'Sender keys must stay out of browser configuration.');
$method = new ReflectionMethod($plugin, 'send_notification');
$method->setAccessible(true);
$settings += ['service_url' => ''];
$result = $method->invoke($plugin, $settings, ['title' => 'Hello']);
check_contract(!is_wp_error($result) && $result['sent'] === 0, 'Zero subscribers must not be represented as a delivery.');
check_contract($remote_request['url'] === 'https://push.example.org/api/notifications', 'Use the implemented send route.');
check_contract($remote_request['args']['headers']['X-Api-Key'] === 'private-sender-key', 'Authenticate server-to-server requests.');
check_contract($remote_request['args']['headers']['X-Push-Source'] === 'wordpress', 'Attribute WordPress campaigns without exposing the sender key.');
check_contract(json_decode($remote_request['args']['body'], true)['domain_key'] === 'domain-key', 'Send the selected domain key.');
$response_status = 401;
$response_data = ['ok' => false, 'message' => 'Invalid sender key.'];
check_contract(is_wp_error($method->invoke($plugin, $settings, ['title' => 'Hello'])), 'API failures must be returned as errors.');
echo "WordPress plugin integration checks passed.\n";
