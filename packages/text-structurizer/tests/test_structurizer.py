"""Tests de contrat et de non-régression du structurizer (stdlib uniquement)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_DIR))

import structurizer  # noqa: E402


class NormalizeTests(unittest.TestCase):
    def test_normalize_unifies_line_endings_and_blank_lines(self) -> None:
        self.assertEqual(structurizer.normalize("A  \r\nB\r\n\r\n\r\nC"), "A\nB\n\nC")


class BuildDocumentTests(unittest.TestCase):
    def test_single_word_intertitle_is_not_absorbed_into_paragraph(self) -> None:
        doc = structurizer.build_document(
            "# Rapport\n\nIntroduction\nLe présent document décrit le sujet."
        )

        self.assertEqual(doc["metadata"]["title"], "Rapport")
        self.assertEqual(
            [(block["type"], block.get("text")) for block in doc["blocks"]],
            [
                ("heading", "Introduction"),
                ("paragraph", "Le présent document décrit le sujet."),
            ],
        )
        self.assertEqual([entry["text"] for entry in doc["toc"]], ["Introduction"])

    def test_author_line_is_metadata_not_a_heading(self) -> None:
        doc = structurizer.build_document(
            "# Rapport\n\nPar Alice Martin\n\n## Introduction\nTexte du rapport."
        )

        self.assertEqual(doc["metadata"]["author"], "Alice Martin")
        self.assertEqual([entry["text"] for entry in doc["toc"]], ["Introduction"])
        self.assertFalse(
            any(block.get("text") == "Par Alice Martin" for block in doc["blocks"])
        )

    def test_heading_levels_remain_contiguous_after_document_title_is_removed(self) -> None:
        doc = structurizer.build_document(
            "# Rapport\n\n## Méthode\nTexte.\n\n### Détail\nPrécision."
        )
        levels = [block["level"] for block in doc["blocks"] if block["type"] == "heading"]

        self.assertEqual(levels, [1, 2])
        self.assertEqual([entry["level"] for entry in doc["toc"]], levels)

    def test_markdown_table_and_lists_preserve_their_block_types(self) -> None:
        doc = structurizer.build_document(
            "# Inventaire\n\n- Pommes\n- Poires\n\n"
            "| Nom | Quantité |\n| --- | --- |\n| Pommes | 3 |"
        )

        self.assertEqual([block["type"] for block in doc["blocks"]], ["list", "table"])
        self.assertEqual(doc["blocks"][0]["items"], ["Pommes", "Poires"])
        self.assertEqual(doc["blocks"][1]["header"], ["Nom", "Quantité"])
        self.assertEqual(doc["blocks"][1]["rows"], [["Pommes", "3"]])

    def test_document_keeps_schema_and_toc_anchor_consistency(self) -> None:
        doc = structurizer.build_document("# Guide\n\n## Première partie\nTexte.")

        self.assertEqual(doc["schema"], structurizer.SCHEMA_VERSION)
        block_ids = {block["id"] for block in doc["blocks"] if block["type"] == "heading"}
        self.assertEqual({entry["id"] for entry in doc["toc"]}, block_ids)
        self.assertEqual(doc["metadata"]["wordCount"], 4)


if __name__ == "__main__":
    unittest.main()
