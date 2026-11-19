"""Share the existing private-file and atomic-write checks with host monitoring."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('notizo_offsite', Path(__file__).with_name('offsite-backup.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
private_file = module.private_file
write_json = module.write_json
seal_snapshot = module.seal_snapshot
fingerprint = module.fingerprint
