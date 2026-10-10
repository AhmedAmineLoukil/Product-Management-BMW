"""Safe, actionable local API errors without provider bodies or credentials."""
import json


def error_response(exc: Exception, operation: str) -> dict:
    try:
        import openai
    except ImportError:
        return {'error': 'Install requirements.txt and restart the app.', 'code': 'dependencies_unavailable', 'status': 503}
    if isinstance(exc, openai.AuthenticationError):
        return {'error': 'The AI provider rejected the API key. Check the server .env key and restart the app.', 'code': 'invalid_key', 'status': 401}
    if isinstance(exc, (openai.PermissionDeniedError, openai.NotFoundError)):
        return {'error': 'The configured AI model is unavailable to this key. Check OPENAI_CHAT_MODEL or OPENAI_MODEL in the server .env.', 'code': 'model_unavailable', 'status': 403}
    if isinstance(exc, openai.RateLimitError):
        return {'error': 'The AI provider reached a rate or billing limit. Check your API credits and usage limits, then try again.', 'code': 'provider_limit', 'status': 429}
    if isinstance(exc, openai.APITimeoutError):
        return {'error': 'The AI provider timed out. Try again with a smaller request.', 'code': 'provider_timeout', 'status': 504}
    if isinstance(exc, openai.APIConnectionError):
        return {'error': 'Could not reach the AI provider. Check the Internet connection and proxy settings.', 'code': 'provider_connection', 'status': 503}
    if isinstance(exc, openai.BadRequestError):
        return {'error': 'The configured model rejected the request. Check the model settings and try a smaller request.', 'code': 'provider_request', 'status': 422}
    if isinstance(exc, openai.APIError):
        return {'error': 'The AI provider is temporarily unavailable. Try again shortly.', 'code': 'provider_unavailable', 'status': 503}
    if isinstance(exc, json.JSONDecodeError):
        return {'error': 'Invalid JSON request.', 'code': 'invalid_request', 'status': 400}
    from pydantic import ValidationError
    if isinstance(exc, ValidationError):
        return {'error': 'The request or AI response has invalid fields. Check the selected records and try again.', 'code': 'invalid_fields', 'status': 422}
    if isinstance(exc, ValueError):
        return {'error': str(exc), 'code': 'validation_failed', 'status': 422}
    return {'error': f'{operation} is temporarily unavailable. Run start-final.ps1 to check the server setup.', 'code': 'operation_failed', 'status': 503}
