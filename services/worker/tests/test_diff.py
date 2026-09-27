from steps import applier


def test_unified_diff_for_edit() -> None:
    patch = applier.unified_diff("styles/tokens.css", ":root {\n  --a: 1;\n}\n", ":root {\n  --a: 1;\n}\n.dark {\n  --a: 2;\n}\n")
    assert patch.startswith("--- a/styles/tokens.css\n+++ b/styles/tokens.css\n")
    assert "+.dark {" in patch
    assert "-" not in patch.splitlines()[3][:1] or patch.count("\n-") == 1


def test_unified_diff_for_new_file() -> None:
    patch = applier.unified_diff("components/ThemeToggle.tsx", None, "export const x = 1;\n")
    assert patch.startswith("--- /dev/null\n+++ b/components/ThemeToggle.tsx\n")
    assert "+export const x = 1;" in patch


def test_unified_diffs_keep_order_and_shape() -> None:
    diffs = applier.unified_diffs({"a.ts": "1\n", "b.ts": None}, {"a.ts": "2\n", "b.ts": "new\n"})
    assert [d["path"] for d in diffs] == ["a.ts", "b.ts"]
    assert set(diffs[0]) == {"path", "patch"}
