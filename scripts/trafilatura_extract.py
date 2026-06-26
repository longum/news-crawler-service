#!/usr/bin/env python3
import argparse
import json
import sys
import time
import traceback

try:
    import trafilatura
except Exception as exc:
    print(
        json.dumps(
            {
                "ok": False,
                "error": f"Unable to import trafilatura: {type(exc).__name__}: {exc}",
            },
            ensure_ascii=False,
        )
    )
    sys.exit(1)


def extract_with_format(html: str, output_format: str, favor_precision: bool):
    kwargs = {
        "output_format": output_format,
        "include_links": True,
        "include_images": True,
        "include_formatting": True,
        "favor_precision": favor_precision,
    }
    return trafilatura.extract(html, **kwargs)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["default", "precision"], default="default")
    args = parser.parse_args()
    favor_precision = args.mode == "precision"

    started = time.perf_counter()
    html = sys.stdin.read()
    try:
        metadata_raw = extract_with_format(html, "json", favor_precision)
        content_html = extract_with_format(html, "html", favor_precision)
        text_content = extract_with_format(html, "txt", favor_precision)

        metadata = {}
        if metadata_raw:
            try:
                parsed_metadata = json.loads(metadata_raw)
                if isinstance(parsed_metadata, dict):
                    metadata = parsed_metadata
            except json.JSONDecodeError:
                metadata = {}

        result = {
            "ok": bool(content_html or text_content),
            "mode": args.mode,
            "durationMs": round((time.perf_counter() - started) * 1000, 3),
            "title": metadata.get("title"),
            "author": metadata.get("author"),
            "date": metadata.get("date"),
            "description": metadata.get("description"),
            "sitename": metadata.get("sitename"),
            "contentHtml": content_html or "",
            "textContent": text_content or metadata.get("text") or "",
            "error": None if (content_html or text_content) else "trafilatura returned empty content",
        }
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["ok"] else 2
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "mode": args.mode,
                    "durationMs": round((time.perf_counter() - started) * 1000, 3),
                    "error": f"{type(exc).__name__}: {exc}",
                    "trace": traceback.format_exc(limit=3),
                },
                ensure_ascii=False,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
