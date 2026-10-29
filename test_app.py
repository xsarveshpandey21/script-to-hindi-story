import unittest
from unittest.mock import patch, MagicMock
from app import app, split_script_into_chunks, DEFAULT_SYSTEM_PROMPT, stream_story_generation
from sample_script import SAMPLE_SCRIPT


class TestScriptToHindiStory(unittest.TestCase):

    def test_default_system_prompt_rules(self):
        """Verify that the 5 core AI rules are present."""
        self.assertIn("Write only in Hindi (Devanagari)", DEFAULT_SYSTEM_PROMPT)
        self.assertIn("Remove speaker labels", DEFAULT_SYSTEM_PROMPT)
        self.assertIn("No headings, subheadings, bullets", DEFAULT_SYSTEM_PROMPT)
        self.assertIn("Start exactly where the script starts", DEFAULT_SYSTEM_PROMPT)
        self.assertIn("Do not add any introduction", DEFAULT_SYSTEM_PROMPT)

    def test_sample_script_length(self):
        """Verify sample script has at least 3,000 words."""
        words = len(SAMPLE_SCRIPT.strip().split())
        self.assertGreaterEqual(words, 3000, f"Expected >= 3000 words, got {words}")

    def test_chunking_with_sample_script(self):
        """Verify chunking does not exceed specified limit."""
        chunks = split_script_into_chunks(SAMPLE_SCRIPT, 12000)
        self.assertGreaterEqual(len(chunks), 1)
        for i, chunk in enumerate(chunks):
            self.assertLessEqual(len(chunk), 12000, f"Chunk {i+1} exceeds 12,000 characters")

    def test_chunking_boundary_preservation(self):
        """Verify chunking splits on paragraph boundaries."""
        sample_text = "Paragraph one content.\n\nParagraph two content.\n\nParagraph three content."
        chunks = split_script_into_chunks(sample_text, 50)
        self.assertGreater(len(chunks), 1)
        for chunk in chunks:
            self.assertLessEqual(len(chunk), 50)

    def test_flask_index_route(self):
        """Test GET / serves HTML page."""
        client = app.test_client()
        response = client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Script to Hindi Story", response.data)

    def test_flask_sample_script_route(self):
        """Test GET /api/sample_script returns JSON with script."""
        client = app.test_client()
        response = client.get('/api/sample_script')
        self.assertEqual(response.status_code, 200)
        json_data = response.get_json()
        self.assertIn("script", json_data)
        self.assertGreaterEqual(len(json_data["script"].split()), 3000)

    def test_generate_story_validation_errors(self):
        """Test POST /api/generate_story validates keys and script."""
        client = app.test_client()

        # Missing keys
        resp1 = client.post('/api/generate_story', json={'script': 'Hello', 'keys': []})
        self.assertEqual(resp1.status_code, 400)
        self.assertIn("valid Gemini API key", resp1.get_json()["error"])

        # Missing script
        resp2 = client.post('/api/generate_story', json={'script': '', 'keys': [{'id': 1, 'key': 'test'}]})
        self.assertEqual(resp2.status_code, 400)
        self.assertIn("script or transcript", resp2.get_json()["error"])

    @patch('time.sleep')
    @patch('app.call_gemini_api')
    def test_key_rotation_and_retry(self, mock_gemini, mock_sleep):
        """
        Simulate Key 1 failing with HTTP 429 / 400,
        verify that Key 2 is tried, succeeds, and next chunk uses Key 3 (round-robin).
        """
        mock_fail = MagicMock()
        mock_fail.ok = False
        mock_fail.status_code = 400
        mock_fail.json.return_value = {"error": {"message": "API key not valid"}}

        mock_ok_1 = MagicMock()
        mock_ok_1.ok = True
        mock_ok_1.json.return_value = {
            "candidates": [{
                "content": {"parts": [{"text": "भाग 1 की कहानी देवनागरी में।"}]}
            }]
        }

        mock_ok_2 = MagicMock()
        mock_ok_2.ok = True
        mock_ok_2.json.return_value = {
            "candidates": [{
                "content": {"parts": [{"text": "भाग 2 की कहानी आगे निरंतर।"}]}
            }]
        }

        mock_gemini.side_effect = [mock_fail, mock_ok_1, mock_ok_2]

        keys = [
            {"id": 1, "key": "bad-key-1"},
            {"id": 2, "key": "good-key-2"},
            {"id": 3, "key": "good-key-3"}
        ]

        # Exactly 2 chunks
        two_chunk_script = "First story chunk content.\n\nSecond story chunk content."
        generator = stream_story_generation(
            script_text=two_chunk_script,
            keys=keys,
            model="gemini-2.5-flash",
            chunk_size=35,
            system_instruction=DEFAULT_SYSTEM_PROMPT
        )

        events = list(generator)
        event_str = "".join(events)

        # Assert Key 1 failed and Key 2 was retried
        self.assertIn("Key 1 failed", event_str)
        self.assertIn("Retrying with Key 2", event_str)
        self.assertIn("भाग 1 की कहानी", event_str)
        self.assertIn("भाग 2 की कहानी", event_str)

        # Verify call arguments
        call_keys_used = [call[0][1] for call in mock_gemini.call_args_list]
        self.assertEqual(call_keys_used[0], "bad-key-1")
        self.assertEqual(call_keys_used[1], "good-key-2")
        self.assertEqual(call_keys_used[2], "good-key-3")
        mock_sleep.assert_called_with(1.2)


if __name__ == "__main__":
    unittest.main()
