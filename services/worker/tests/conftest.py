import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
os.environ.setdefault("GITHUB_TOKEN", "test-github-token")
os.environ.setdefault("VERCEL_TOKEN", "test-vercel-token")

# The retries in `steps/retry.py` are about a real network. In a test a refused connection is the
# mock saying "nothing registered for that", so every attempt is made at once: the retrying is
# still exercised, the waiting is not.
from steps import retry  # noqa: E402

retry.BASE_DELAY_S = 0.0
