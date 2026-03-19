import os
from dotenv import load_dotenv
from flask import Flask

load_dotenv()
from flask_cors import CORS
from routes import register_routes

# src/ directory and project root (one level up)
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Serve React build files from <project_root>/frontend/dist
app = Flask(__name__,
    static_folder=os.path.join(project_root, 'frontend', 'dist'),
    static_url_path='')
CORS(app)

# Register routes
register_routes(app)

if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0", port=5001)
