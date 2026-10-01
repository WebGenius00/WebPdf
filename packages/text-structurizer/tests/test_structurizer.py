"""Tests de contrat et de non-régression du structurizer (stdlib uniquement)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_DIR))

import structurizer  # noqa: E402
import renderer  # noqa: E402


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

    def test_plain_numbered_headings_keep_hierarchy_and_drop_source_numbers(self) -> None:
        doc = structurizer.build_document(
            "Guide\n\nIntroduction\nTexte.\n\n"
            "1. Principes\nTexte.\n\n"
            "1.1 Détail\nTexte.\n\n"
            "2. Suite\nTexte."
        )

        headings = [b for b in doc["blocks"] if b["type"] == "heading"]
        self.assertEqual([(b["level"], b["number"], b["text"]) for b in headings], [
            (1, "1", "Introduction"),
            (1, "2", "Principes"),
            (2, "2.1", "Détail"),
            (1, "3", "Suite"),
        ])


class FurnitureCssTests(unittest.TestCase):
    def test_default_header_and_footer_keep_dynamic_page_labels(self) -> None:
        css = renderer.build_css()

        self.assertIn('content: "PDF STUDIO"; text-align: left;', css)
        self.assertIn('content: "Page " counter(page) " sur " counter(pages);', css)
        self.assertIn('content: string(sectiontitle);', css)

    def test_custom_zones_expand_template_variables(self) -> None:
        css = renderer.build_css(furniture={
            "header": {
                "enabled": True,
                "left": "Dossier : {title}",
                "center": "{page}/{pages}",
                "right": "{section}",
            },
        })

        self.assertIn('content: "Dossier : " string(doctitle); text-align: left;', css)
        self.assertIn('content: counter(page) "/" counter(pages); text-align: center;', css)
        self.assertIn('content: string(sectiontitle); text-align: right;', css)

    def test_user_text_is_escaped_as_a_css_string(self) -> None:
        label = 'Dossier "Alpha"; } @page { color: red;'
        css = renderer.build_css(furniture={"header": {"left": label}})

        self.assertIn(f'content: {renderer._css_string(label)}; text-align: left;', css)
        self.assertNotIn(f'content: {label};', css)

    def test_disabled_furniture_is_hidden_and_cover_can_be_enabled(self) -> None:
        css = renderer.build_css(furniture={
            "header": {"enabled": False},
            "footer": {"enabled": True, "onCover": True, "left": "Confidentiel"},
        })

        self.assertIn('@top-left { content: none; text-align: left; border: 0; padding: 0;', css)
        self.assertIn('@page :first { @bottom-left { content: "Confidentiel";', css)

    def test_cli_accepts_furniture_json(self) -> None:
        options = renderer.parse_args([
            "--stdin", "/tmp/out.pdf", "--furniture", '{"header":{"left":"Projet"}}',
        ])

        self.assertEqual(options["furniture"], '{"header":{"left":"Projet"}}')


if __name__ == "__main__":
    unittest.main()
