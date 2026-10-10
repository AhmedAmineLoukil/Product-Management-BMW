
import os
import unittest
from unittest.mock import patch, MagicMock

# Dummy key for testing: no real API request will be made.
os.environ.setdefault("OPENAI_API_KEY", "sk-test-placeholder")

from src.ai.generate_requirements import (
    generate_requirements,
    ProposedRequirement,
)


class TestGenerateRequirements(unittest.TestCase):

    @patch("src.ai.generate_requirements.client.responses.parse")
    def test_requirement_preserves_evidence(self, mock_parse):

        # 1. Prepare fictional input
        clusters = [
            {
                "cluster_id": "CLUSTER-001",
                "title": "Long-distance seat discomfort",
                "category": "Comfort",
                "summary": "Customers report uncomfortable seats.",
                "finding_ids": ["FIND-001", "FIND-002"],
                "source_ids": ["FEEDBACK-001", "FEEDBACK-002"],
                "feedback_count": 2,
                "uncertainty": ""
            }
        ]

        # 2. Simulate an AI response
        mock_parse.return_value = MagicMock(
            output_parsed=ProposedRequirement(
                title="Improve seat comfort",
                requirement=(
                    "The seating system should improve "
                    "comfort during long drives."
                ),
                rationale="Customers report discomfort.",
                uncertainty="No measurable comfort target.",
                confidence="medium"
            )
        )

        # 3. Run the actual Python function
        results = generate_requirements(clusters)

        # 4. Check the result
        self.assertEqual(len(results), 1)
        self.assertEqual(
            results[0]["cluster_id"],
            "CLUSTER-001"
        )
        self.assertEqual(
            results[0]["source_ids"],
            ["FEEDBACK-001", "FEEDBACK-002"]
        )
        self.assertEqual(
            results[0]["review_status"],
            "pending"
        )

        # Check that the OpenAI call was mocked
        mock_parse.assert_called_once()


if __name__ == "__main__":
    unittest.main()
