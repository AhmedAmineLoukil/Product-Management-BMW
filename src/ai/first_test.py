
from openai import OpenAI
from dotenv import load_dotenv

# Step 1: Load the API key from .env
load_dotenv()

# Step 2: Create the OpenAI client
client = OpenAI()

# Step 3: Create fictional customer feedback
feedback = """
The seats become uncomfortable after two hours of driving.
"""

# Step 4: Send the feedback to the AI
response = client.responses.create(
    model="gpt-4.1-mini",
    instructions="""
    You are an automotive customer feedback analyst.

    Analyze the customer feedback and identify:
    1. The main customer complaint
    2. The category of the complaint
    3. The underlying customer need

    Only use information supported by the feedback.
    """,
    input=feedback
)

# Step 5: Print the AI response
print(response.output_text)
