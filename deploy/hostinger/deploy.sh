#!/usr/bin/env bash
# Install a root-owned copy at /usr/local/sbin/deploy-push-notifications.
set -Eeuo pipefail
umask 077

die() { printf '%s\n' "$*" >&2; exit 1; }
if [[ -n ${SSH_ORIGINAL_COMMAND:-} ]]; then
    [[ "$SSH_ORIGINAL_COMMAND" =~ ^deploy\ ([0-9a-f]{40})$ ]] || die 'Only deploy followed by a full commit SHA is allowed.'
    target="${BASH_REMATCH[1]}"
    repo_dir=/opt/push-notification-app
else
    [[ $# -eq 1 && "$1" =~ ^[0-9a-f]{40}$ ]] || die 'Usage: deploy-push-notifications FULL_COMMIT_SHA'
    target="$1"
    # Override is for local test fixtures/manual administration, never an SSH command.
    repo_dir="${PUSH_DEPLOY_ROOT:-/opt/push-notification-app}"
fi
for tool in git docker flock curl; do
    command -v "$tool" >/dev/null || die "Missing required command: $tool"
done
cd -- "$repo_dir"
repo_dir="$(pwd -P)"
[[ -d .git ]] || die 'Expected a standalone Git checkout.'
git_root="$(git rev-parse --show-toplevel)"
git_root="$(cd -- "$git_root" && pwd -P)"
[[ "$git_root" -ef "$repo_dir" ]] || die 'Expected a standalone Git checkout.'
exec 9> .git/hostinger-deploy.lock
flock -n 9 || die 'Another deployment is already running.'
[[ "$(git branch --show-current)" == main ]] || die 'The VPS checkout must be on main.'
git diff --quiet && git diff --cached --quiet || die 'Tracked VPS files have local changes; resolve them before deploying.'
[[ "$(git remote get-url origin)" == https://github.com/info-321/push-notification-app.git ]] || die 'Unexpected Git origin.'
git fetch --no-tags origin main
latest="$(git rev-parse refs/remotes/origin/main)"
if [[ "$target" != "$latest" ]]; then
    printf 'Skipped stale run: this commit is no longer the latest main.\n'
    exit 0
fi
previous="$(git rev-parse HEAD)"
git merge-base --is-ancestor "$previous" "$target" || die 'Deployment must fast-forward; no reset was performed.'
[[ -z "$(git ls-tree -r --name-only "$target" -- deploy/hostinger/.env deploy/hostinger/backups server/.env client/.env)" ]] || die 'A private deployment path is tracked in the target commit.'
# Changing these requires a coordinated database/infrastructure deployment.
git diff --quiet "$previous" "$target" -- deploy/hostinger/compose.yml server/db/schema.sql || die 'Compose or schema changed. Apply and verify that migration manually before automatic app deployments.'

deploy_dir="$repo_dir/deploy/hostinger"
cd -- "$deploy_dir"
[[ -f .env ]] || die 'The existing Hostinger .env is missing.'
compose=(docker compose --project-name push-notification-app --project-directory "$deploy_dir" --file "$deploy_dir/compose.yml" --env-file "$deploy_dir/.env")
"${compose[@]}" config --quiet
# Back up with the previously installed code before changing the checkout.
bash "$deploy_dir/backup.sh"
mkdir -p backups/deployments
chmod 700 backups backups/deployments
state="$(mktemp -d "$deploy_dir/backups/deployments/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
cp -- compose.yml "$state/compose.before.yml"
printf '%s\n' "$previous" > "$state/checkout-before.txt"
printf '%s\n' "$target" > "$state/requested-commit.txt"
stamp="${state##*/}"
for service in api web; do
    cid="$("${compose[@]}" ps --all --quiet "$service")"
    [[ -n "$cid" && "$cid" != *$'\n'* ]] || die "Expected one existing $service container."
    image="$(docker inspect --format '{{.Image}}' "$cid")"
    docker image tag "$image" "push-notification-app-$service:rollback-$stamp"
done
printf 'services:\n  api:\n    image: push-notification-app-api:rollback-%s\n  web:\n    image: push-notification-app-web:rollback-%s\n' "$stamp" "$stamp" > "$state/rollback.yml"

cutover_started=false
failed() {
    local status=$?
    trap - ERR
    if [[ "$cutover_started" == true ]]; then
        printf 'Deployment checks failed. Restoring the previous running app images.\n' >&2
        if docker compose --project-name push-notification-app --project-directory "$deploy_dir" \
            --file "$state/compose.before.yml" --file "$state/rollback.yml" --env-file "$deploy_dir/.env" \
            up -d --no-deps --no-build --pull never --wait --wait-timeout 180 api web; then
            printf 'Previous app images restored; the deployment is still marked failed.\n' >&2
        else
            printf 'Automatic image rollback failed; inspect the app containers immediately.\n' >&2
        fi
    else
        printf 'Deployment stopped before container replacement.\n' >&2
    fi
    printf 'Deployment recovery files: %s\n' "$state" >&2
    exit "$status"
}
trap failed ERR
cd -- "$repo_dir"
git merge --ff-only "$target"
cd -- "$deploy_dir"
"${compose[@]}" config --quiet
# Build sequentially to limit CPU/memory use while existing containers serve traffic.
"${compose[@]}" build api
"${compose[@]}" build web
cutover_started=true
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 api web
"${compose[@]}" exec -T api node --input-type=module < "$deploy_dir/check.mjs"
curl --fail --silent --show-error --max-time 20 --output /dev/null http://127.0.0.1:3001/
printf '%s\n' "$target" > "$state/successful-commit.txt"
trap - ERR
printf 'Deployment passed for commit %s\n' "$target"
