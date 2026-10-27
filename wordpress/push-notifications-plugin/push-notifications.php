<?php
/**
 * Plugin Name: Push Notifications Plugin
 * Description: Sends push notifications when posts are published and allows manual sends from the dashboard.
 * Version: 1.1.1
 * Author: ABHIJIT BOSE
 * Requires at least: 5.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

class Push_Notifications_Plugin {
    const OPTION_KEY = 'push_notifications_settings';

    public function __construct() {
        add_action('init', [$this, 'serve_service_worker'], 0);
        add_action('admin_menu', [$this, 'add_settings_page']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_frontend']); // Inject SDK + config for visitors
        add_action('transition_post_status', [$this, 'maybe_send_on_publish'], 10, 3);
        add_action('admin_post_push_notifications_send', [$this, 'handle_manual_send']);
    }

    public static function activate() {
        add_option(self::OPTION_KEY, self::default_settings());
    }

    private static function default_settings() {
        return [
            'service_url'      => '',
            'api_key'          => '',
            'domain_key'       => '', // per-domain key from your SaaS
            'api_base'         => '', // API base that serves /sdk/push.js
            'vapid_public_key' => '',
            'sw_path'          => '', // service worker path
            'default_title'    => 'New post on {site}',
            'default_body'     => '{title} just went live. Read now: {link}',
            'icon_url'         => '',
            'cta_label'        => 'Read Now',
            'enable_on_publish' => 0,
        ];
    }

    private function get_settings() {
        $saved = get_option(self::OPTION_KEY, []);
        return wp_parse_args($saved, self::default_settings());
    }

    public function add_settings_page() {
        add_options_page(
            __('Push Notifications', 'push-notifications-plugin'),
            __('Push Notifications', 'push-notifications-plugin'),
            'manage_options',
            'push-notifications-plugin',
            [$this, 'render_settings_page']
        );
    }

    public function register_settings() {
        register_setting('push_notifications_options', self::OPTION_KEY, [$this, 'sanitize_settings']);

        add_settings_section(
            'push_notifications_main',
            __('Delivery Settings', 'push-notifications-plugin'),
            function () {
                echo '<p>Configure the push delivery endpoint. Tokens available: {site}, {title}, {link}.</p>';
            },
            'push-notifications-plugin'
        );

        add_settings_field(
            'service_url',
            __('Service URL', 'push-notifications-plugin'),
            function () {
                $settings = $this->get_settings();
                printf(
                    '<input type="url" name="%1$s[service_url]" class="regular-text code" value="%2$s" placeholder="Leave blank to use API Base + /api/notifications" />',
                    esc_attr(self::OPTION_KEY),
                    esc_attr($settings['service_url'])
                );
            },
            'push-notifications-plugin',
            'push_notifications_main'
        );

        add_settings_field(
            'api_key',
            __('Sender API Key', 'push-notifications-plugin'),
            function () {
                $settings = $this->get_settings();
                printf(
                    '<input type="text" name="%1$s[api_key]" class="regular-text" value="%2$s" autocomplete="off" />',
                    esc_attr(self::OPTION_KEY),
                    esc_attr($settings['api_key'])
                );
            },
            'push-notifications-plugin',
            'push_notifications_main'
        );

        add_settings_field(
            'domain_key',
            __('Domain Key', 'push-notifications-plugin'),
            function () {
                $settings = $this->get_settings();
                printf(
                    '<input type="text" name="%1$s[domain_key]" class="regular-text code" value="%2$s" placeholder="e.g. K2NWunYe" required />',
                    esc_attr(self::OPTION_KEY),
                    esc_attr($settings['domain_key'])
                );
            },
            'push-notifications-plugin',
            'push_notifications_main'
        );

        add_settings_field(
            'api_base',
            __('API Base (serves /sdk/push.js)', 'push-notifications-plugin'),
            function () {
                $settings = $this->get_settings();
                printf(
                    '<input type="url" name="%1$s[api_base]" class="regular-text code" value="%2$s" placeholder="https://api.example.com" required />',
                    esc_attr(self::OPTION_KEY),
                    esc_attr($settings['api_base'])
                );
            },
            'push-notifications-plugin',
            'push_notifications_main'
        );

        add_settings_field(
            'sw_path',
            __('Service Worker Path', 'push-notifications-plugin'),
            function () {
                $settings = $this->get_settings();
                printf(
                    '<input type="text" name="%1$s[sw_path]" class="regular-text code" value="%2$s" placeholder="Automatic (bundled service worker)" />',
                    esc_attr(self::OPTION_KEY),
                    esc_attr($settings['sw_path'])
                );
                echo '<p class="description">Leave this empty to use the service worker bundled with this plugin. Set a custom path only for an existing integration.</p>';
            },
            'push-notifications-plugin',
            'push_notifications_main'
        );

        add_settings_field(
            'vapid_public_key',
            __('VAPID Public Key', 'push-notifications-plugin'),
            function () {
                $settings = $this->get_settings();
                printf('<input type="text" name="%1$s[vapid_public_key]" class="large-text code" value="%2$s" required />', esc_attr(self::OPTION_KEY), esc_attr($settings['vapid_public_key']));
                echo '<p class="description">Copy the VAPID public key from your site configuration. Never enter a private key.</p>';
            },
            'push-notifications-plugin',
            'push_notifications_main'
        );

        add_settings_field(
            'default_title',
            __('Default Title', 'push-notifications-plugin'),
            function () {
                $settings = $this->get_settings();
                printf(
                    '<input type="text" name="%1$s[default_title]" class="regular-text" value="%2$s" />',
                    esc_attr(self::OPTION_KEY),
                    esc_attr($settings['default_title'])
                );
            },
            'push-notifications-plugin',
            'push_notifications_main'
        );

        add_settings_field(
            'default_body',
            __('Default Body', 'push-notifications-plugin'),
            function () {
                $settings = $this->get_settings();
                printf(
                    '<textarea name="%1$s[default_body]" rows="4" class="large-text">%2$s</textarea>',
                    esc_attr(self::OPTION_KEY),
                    esc_textarea($settings['default_body'])
                );
            },
            'push-notifications-plugin',
            'push_notifications_main'
        );

        add_settings_field(
            'icon_url',
            __('Notification Icon URL', 'push-notifications-plugin'),
            function () {
                $settings = $this->get_settings();
                printf(
                    '<input type="url" name="%1$s[icon_url]" class="regular-text code" value="%2$s" placeholder="https://example.com/icon.png" />',
                    esc_attr(self::OPTION_KEY),
                    esc_attr($settings['icon_url'])
                );
            },
            'push-notifications-plugin',
            'push_notifications_main'
        );

        add_settings_field(
            'cta_label',
            __('Button Label', 'push-notifications-plugin'),
            function () {
                $settings = $this->get_settings();
                printf(
                    '<input type="text" name="%1$s[cta_label]" class="regular-text" value="%2$s" />',
                    esc_attr(self::OPTION_KEY),
                    esc_attr($settings['cta_label'])
                );
            },
            'push-notifications-plugin',
            'push_notifications_main'
        );

        add_settings_field(
            'enable_on_publish',
            __('Send on publish', 'push-notifications-plugin'),
            function () {
                $settings = $this->get_settings();
                printf(
                    '<label><input type="checkbox" name="%1$s[enable_on_publish]" value="1" %2$s /> Send push notifications when posts are published</label>',
                    esc_attr(self::OPTION_KEY),
                    checked(1, (int) $settings['enable_on_publish'], false)
                );
            },
            'push-notifications-plugin',
            'push_notifications_main'
        );
    }

    public function sanitize_settings($input) {
        $output = self::default_settings();

        if (isset($input['service_url'])) {
            $output['service_url'] = esc_url_raw(trim($input['service_url']));
        }

        if (isset($input['domain_key'])) {
            $output['domain_key'] = sanitize_text_field($input['domain_key']);
        }

        if (isset($input['api_base'])) {
            $output['api_base'] = esc_url_raw(trim($input['api_base']));
        }

        if (isset($input['vapid_public_key'])) {
            $output['vapid_public_key'] = sanitize_text_field($input['vapid_public_key']);
        }

        if (isset($input['sw_path'])) {
            $output['sw_path'] = sanitize_text_field($input['sw_path']);
        }

        if (isset($input['api_key'])) {
            $output['api_key'] = sanitize_text_field($input['api_key']);
        }

        if (isset($input['default_title'])) {
            $output['default_title'] = sanitize_text_field($input['default_title']);
        }

        if (isset($input['default_body'])) {
            $output['default_body'] = sanitize_textarea_field($input['default_body']);
        }

        if (isset($input['icon_url'])) {
            $output['icon_url'] = esc_url_raw(trim($input['icon_url']));
        }

        if (isset($input['cta_label'])) {
            $output['cta_label'] = sanitize_text_field($input['cta_label']);
        }

        $output['enable_on_publish'] = isset($input['enable_on_publish']) ? 1 : 0;

        return $output;
    }

    /**
     * Enqueue frontend SDK and push config for visitors.
     * Injects a small inline script with domainKey/apiBase/swPath so your hosted SDK can register SW and subscribe.
     */
    public function enqueue_frontend() {
        $settings = $this->get_settings();
        // Bail if not configured
        if (empty($settings['api_base']) || empty($settings['domain_key']) || empty($settings['vapid_public_key'])) {
            return;
        }

        // Enqueue your hosted SDK (expected at {api_base}/sdk/push.js)
        wp_enqueue_script(
            'push-notifications-sdk',
            trailingslashit($settings['api_base']) . 'sdk/push.js',
            [],
            '1.1.1',
            true
        );

        // Inline config object read by the SDK
        $cfg = [
            'domainKey'      => $settings['domain_key'],
            'apiBase'        => untrailingslashit($settings['api_base']),
            'vapidPublicKey' => $settings['vapid_public_key'],
            'swPath'         => $settings['sw_path'] ?: add_query_arg('ttw_push_worker', '1', home_url('/')),
            'swScope'        => wp_parse_url(home_url('/'), PHP_URL_PATH) ?: '/',
            // Optional hints to show nicer notifications if present
            'fallbackTitle'  => $settings['default_title'],
            'fallbackBody'   => $settings['default_body'],
            'fallbackIcon'   => $settings['icon_url'],
        ];

        wp_add_inline_script(
            'push-notifications-sdk',
            'window.pushConfig = ' . wp_json_encode($cfg, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ';',
            'before'
        );
    }

    public function maybe_send_on_publish($new_status, $old_status, $post) {
        if ('publish' !== $new_status || 'publish' === $old_status) {
            return;
        }

        if (wp_is_post_revision($post) || 'post' !== $post->post_type || !empty($post->post_password)) {
            return;
        }

        $settings = $this->get_settings();
        if (empty($settings['enable_on_publish'])) {
            return;
        }

        $payload = $this->build_payload($settings, $post);
        $result = $this->send_notification($settings, $payload);
        if (is_wp_error($result)) {
            error_log('Push notification publish failed: ' . $result->get_error_message());
        }
    }

    public function handle_manual_send() {
        if (!current_user_can('manage_options')) {
            wp_die(__('You do not have permission to do this.', 'push-notifications-plugin'));
        }

        check_admin_referer('push_notifications_send', 'push_notifications_send_nonce');

        $settings = $this->get_settings();

        $title = isset($_POST['manual_title']) ? sanitize_text_field(wp_unslash($_POST['manual_title'])) : '';
        $body  = isset($_POST['manual_body']) ? sanitize_textarea_field(wp_unslash($_POST['manual_body'])) : '';
        $url   = isset($_POST['manual_url']) ? esc_url_raw(wp_unslash($_POST['manual_url'])) : home_url();

        if (empty($settings['api_base']) || empty($settings['api_key']) || empty($settings['domain_key'])) {
            $redirect = add_query_arg('pnp_error', 1, menu_page_url('push-notifications-plugin', false));
            wp_safe_redirect($redirect);
            exit;
        }

        $payload = [
            'title' => $title ?: $settings['default_title'],
            'body'  => $body ?: $settings['default_body'],
            'url'   => $url,
            'site'  => get_bloginfo('name'),
            'icon'  => $settings['icon_url'],
            'cta'   => $settings['cta_label'],
        ];

        $result = $this->send_notification($settings, $payload);
        $failed = is_wp_error($result);
        set_transient('pnp_result_' . get_current_user_id(), $failed ? $result->get_error_message() : $result['message'], 60);

        $redirect = add_query_arg($failed ? 'pnp_error' : 'pnp_sent', 1, menu_page_url('push-notifications-plugin', false));
        wp_safe_redirect($redirect);
        exit;
    }

    private function build_payload($settings, $post) {
        $tokens = [
            '{site}'  => get_bloginfo('name'),
            '{title}' => get_the_title($post),
            '{link}'  => get_permalink($post),
        ];

        return [
            'title'   => strtr($settings['default_title'], $tokens),
            'body'    => strtr($settings['default_body'], $tokens),
            'url'     => get_permalink($post),
            'post_id' => (int) $post->ID,
            'icon'    => $settings['icon_url'],
            'cta'     => $settings['cta_label'],
        ];
    }

    public function serve_service_worker() {
        if (!isset($_GET['ttw_push_worker']) || '1' !== $_GET['ttw_push_worker']) {
            return;
        }
        header('Content-Type: application/javascript; charset=utf-8');
        header('Service-Worker-Allowed: /');
        header('X-Content-Type-Options: nosniff');
        nocache_headers();
        readfile(__DIR__ . '/push-sw.js');
        exit;
    }

    private function send_notification($settings, $payload) {
        if (empty($settings['api_base']) || empty($settings['api_key']) || empty($settings['domain_key'])) {
            return new WP_Error('pnp_config', 'Configure API Base, Domain Key, and Sender API Key first.');
        }
        $payload['domain_key'] = $settings['domain_key'];
        $endpoint = $settings['service_url'] ?: untrailingslashit($settings['api_base']) . '/api/notifications';
        $response = wp_remote_post($endpoint, [
            'headers' => ['Content-Type' => 'application/json', 'X-Api-Key' => $settings['api_key']],
            'body' => wp_json_encode($payload),
            'timeout' => 30,
        ]);
        if (is_wp_error($response)) {
            return $response;
        }
        $data = json_decode(wp_remote_retrieve_body($response), true);
        $status = wp_remote_retrieve_response_code($response);
        if ($status < 200 || $status >= 300 || !is_array($data) || empty($data['ok'])) {
            return new WP_Error('pnp_send', isset($data['message']) ? $data['message'] : 'The notification API rejected this request.');
        }
        return $data;
    }

    public function render_settings_page() {
        if (!current_user_can('manage_options')) {
            return;
        }

        $settings = $this->get_settings();
        $sent  = isset($_GET['pnp_sent']);
        $error = isset($_GET['pnp_error']);
        $result_message = get_transient('pnp_result_' . get_current_user_id());
        delete_transient('pnp_result_' . get_current_user_id());
        ?>
        <div class="wrap">
            <p>Use the public HTTPS API address and keys from your project Configuration page. The plugin installs the browser SDK and serves its own service worker. You do not need to add the script separately.</p>
            <h1><?php esc_html_e('Push Notifications', 'push-notifications-plugin'); ?></h1>

            <?php if ($sent) : ?>
                <div class="notice notice-success"><p><?php echo esc_html($result_message ?: 'Request completed. Check your subscriber count and delivery result.'); ?></p></div>
            <?php endif; ?>

            <?php if ($error) : ?>
                <div class="notice notice-error"><p><?php echo esc_html($result_message ?: 'Could not send notification. Check your API Base, Domain Key, and Sender API Key.'); ?></p></div>
            <?php endif; ?>

            <form method="post" action="options.php" class="card">
                <?php
                settings_fields('push_notifications_options');
                do_settings_sections('push-notifications-plugin');
                submit_button(__('Save Settings', 'push-notifications-plugin'));
                ?>
            </form>

            <h2><?php esc_html_e('Send a test notification', 'push-notifications-plugin'); ?></h2>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="card">
                <?php wp_nonce_field('push_notifications_send', 'push_notifications_send_nonce'); ?>
                <input type="hidden" name="action" value="push_notifications_send" />
                <table class="form-table" role="presentation">
                    <tbody>
                    <tr>
                        <th scope="row"><label for="manual_title"><?php esc_html_e('Title', 'push-notifications-plugin'); ?></label></th>
                        <td><input id="manual_title" name="manual_title" type="text" class="regular-text" value="<?php echo esc_attr($settings['default_title']); ?>" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="manual_body"><?php esc_html_e('Body', 'push-notifications-plugin'); ?></label></th>
                        <td><textarea id="manual_body" name="manual_body" class="large-text" rows="3"><?php echo esc_textarea($settings['default_body']); ?></textarea></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="manual_url"><?php esc_html_e('Link URL', 'push-notifications-plugin'); ?></label></th>
                        <td><input id="manual_url" name="manual_url" type="url" class="regular-text code" value="<?php echo esc_attr(home_url()); ?>" /></td>
                    </tr>
                    </tbody>
                </table>
                <?php submit_button(__('Send Notification', 'push-notifications-plugin'), 'primary'); ?>
            </form>
        </div>
        <?php
    }
}

register_activation_hook(__FILE__, ['Push_Notifications_Plugin', 'activate']);
new Push_Notifications_Plugin();
