#!/usr/bin/env python3
"""Run the patched LangChain Open Deep Research graph for one prompt."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Open Deep Research for one FCD-X prompt.")
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--run-json", required=True)
    parser.add_argument("--thread-id", required=True)
    parser.add_argument("--search-api", default="firecrawl")
    parser.add_argument("--model", default="openai:deepseek-chat")
    parser.add_argument("--summarization-model", default=None)
    parser.add_argument("--compression-model", default=None)
    parser.add_argument("--final-report-model", default=None)
    parser.add_argument("--max-concurrent-research-units", type=int, default=1)
    parser.add_argument("--max-researcher-iterations", type=int, default=2)
    parser.add_argument("--max-react-tool-calls", type=int, default=4)
    parser.add_argument("--research-model-max-tokens", type=int, default=4096)
    parser.add_argument("--summarization-model-max-tokens", type=int, default=4096)
    parser.add_argument("--compression-model-max-tokens", type=int, default=4096)
    parser.add_argument("--final-report-model-max-tokens", type=int, default=8192)
    return parser.parse_args()


def configure_model_env() -> None:
    if not os.environ.get("OPENAI_API_KEY") and os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        os.environ["OPENAI_API_KEY"] = os.environ["ANTHROPIC_AUTH_TOKEN"]
    if not os.environ.get("OPENAI_BASE_URL") and os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        os.environ["OPENAI_BASE_URL"] = "https://api.deepseek.com"


def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def json_safe(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


async def run() -> None:
    args = parse_args()
    configure_model_env()

    # Import after env setup so LangChain providers see the intended keys/base URL.
    from langchain_core.messages import HumanMessage
    from open_deep_research.deep_researcher import deep_researcher

    prompt = Path(args.prompt_file).read_text(encoding="utf8")
    output_path = Path(args.output_file)
    run_json_path = Path(args.run_json)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    run_json_path.parent.mkdir(parents=True, exist_ok=True)

    model = args.model
    configurable = {
        "thread_id": args.thread_id,
        "allow_clarification": False,
        "search_api": args.search_api,
        "max_concurrent_research_units": args.max_concurrent_research_units,
        "max_researcher_iterations": args.max_researcher_iterations,
        "max_react_tool_calls": args.max_react_tool_calls,
        "research_model": model,
        "research_model_max_tokens": args.research_model_max_tokens,
        "compression_model": args.compression_model or model,
        "compression_model_max_tokens": args.compression_model_max_tokens,
        "final_report_model": args.final_report_model or model,
        "final_report_model_max_tokens": args.final_report_model_max_tokens,
        "summarization_model": args.summarization_model or model,
        "summarization_model_max_tokens": args.summarization_model_max_tokens,
    }

    started = time.time()
    start_iso = iso_now()
    event_counts: dict[str, int] = {}
    final_report = ""
    error = None

    try:
        async for event in deep_researcher.astream(
            {"messages": [HumanMessage(content=prompt)]},
            config={"configurable": configurable},
            stream_mode="updates",
        ):
            for node_name, update in event.items():
                event_counts[node_name] = event_counts.get(node_name, 0) + 1
                if isinstance(update, dict) and update.get("final_report"):
                    final_report = str(update["final_report"])

        if not final_report:
            raise RuntimeError("Open Deep Research finished without final_report in the stream")

        output_path.write_text(final_report, encoding="utf8")
    except Exception as exc:  # noqa: BLE001 - write the run metadata before failing.
        error = str(exc)
        raise
    finally:
        end_iso = iso_now()
        run_json_path.write_text(
            json.dumps(
                {
                    "start": start_iso,
                    "end": end_iso,
                    "duration_seconds": round(time.time() - started, 2),
                    "error": error,
                    "event_counts": event_counts,
                    "configurable": configurable,
                    "output_path": str(output_path),
                    "output_chars": len(final_report),
                    "starts_with_json": final_report.lstrip().startswith("{"),
                    "contains_org_chart": "org_chart" in final_report,
                },
                indent=2,
                default=json_safe,
            )
            + "\n",
            encoding="utf8",
        )


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        sys.exit(1)
