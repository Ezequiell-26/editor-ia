import re, sys, pathlib

base = pathlib.Path("apps/desktop/src/features/editor")
names = ["EditorWorkspace", "Timeline", "Preview", "Inspector"]

for name in names:
    p = base / f"{name}.tsx"
    src = p.read_text(encoding="utf-8")

    # 1) React.memo -> memo (ninguno de estos archivos importa el namespace React)
    src = src.replace("React.memo(", "memo(")

    # 2) cerrar el memo: el ultimo } del archivo pasa a });
    body = src.rstrip("\n")
    if not body.endswith("}"):
        sys.exit(f"ERROR {name}: no termina en }} (¿ya estaba cerrado?)")
    src = body[:-1] + "});\n"

    # 3) asegurar el import nombrado `memo` desde 'react'
    m = re.search(r"import\s*\{([^}]*)\}\s*from\s*'react';", src, re.S)
    if not m:
        sys.exit(f"ERROR {name}: no encuentro el import con llaves de 'react'")
    if not re.search(r"\bmemo\b", m.group(1)):
        src = src[: m.start(1)] + "memo, " + src[m.start(1):]

    p.write_text(src, encoding="utf-8")

    open_line = re.search(rf"^export const {name} = memo\(function {name}", src, re.M)
    tail = src.rstrip("\n").splitlines()[-1]
    print(f"OK {name}: apertura={'si' if open_line else 'NO'} cierre={tail!r}")
