"""Safety checks for the disposable git-archive clean-checkout verifier."""
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

from scripts.qa_clean_checkout import safe_export


def archive(name: str, data: bytes = b"test", kind: bytes = tarfile.REGTYPE) -> bytes:
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as bundle:
        item = tarfile.TarInfo(name=name)
        item.type = kind
        if kind == tarfile.REGTYPE:
            item.size = len(data)
            bundle.addfile(item, io.BytesIO(data))
        else:
            item.linkname = "../../should-never-follow"
            bundle.addfile(item)
    return stream.getvalue()


class CleanCheckoutSafetyTests(unittest.TestCase):
    def test_normal_tracked_file_is_exported(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root)
            safe_export(archive("companion/package.json", b'{"name":"qa"}'), target)
            self.assertEqual(
                (target / "companion/package.json").read_bytes(), b'{"name":"qa"}'
            )

    def test_parent_traversal_rejected_without_writing(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(RuntimeError, "Unsafe tracked QA archive"):
                safe_export(archive("../escape.txt"), Path(root))
            self.assertEqual(list(Path(root).iterdir()), [])

    def test_absolute_target_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(RuntimeError, "Unsafe tracked QA archive"):
                safe_export(archive("/tmp/escape.txt"), Path(root))

    def test_symlink_not_extracted(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(RuntimeError, "Unsafe tracked QA archive"):
                safe_export(archive("linked-file", kind=tarfile.SYMTYPE), Path(root))
            self.assertEqual(list(Path(root).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
