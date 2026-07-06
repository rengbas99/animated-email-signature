#!/usr/bin/env python3
"""
src/generator/cloudinary_upload.py
Prefix-isolated Multi-Employee Cloudinary Asset Deployment Syncer
"""
import os
import sys

# Forcefully bypass IDE proxy environment variables to connect directly to Cloudinary
os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)
os.environ.pop("http_proxy", None)
os.environ.pop("https_proxy", None)

import json
import cloudinary
import cloudinary.uploader
from dotenv import load_dotenv

def run_asset_sync():
    # 1. Enforce validation bounds on command parameters
    if len(sys.argv) < 2:
        print("❌ Error: Missing target employee slug token.")
        print("Usage: python3 src/generator/cloudinary_upload.py <slug_name>")
        sys.exit(1)

    slug_name = sys.argv[1]

    # Anchor path configurations safely (project root, three levels up from
    # src/generator/cloudinary_upload.py)
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    dotenv_path = os.path.join(base_dir, '.env')
    load_dotenv(dotenv_path=dotenv_path)

    # 2. Configure authentication credentials
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    api_key = os.getenv("CLOUDINARY_API_KEY")
    api_secret = os.getenv("CLOUDINARY_API_SECRET")

    if not (cloud_name and api_key and api_secret) or cloud_name == "your_cloud_name":
        print("⚠️ Warning: Cloudinary credentials are not configured or still placeholders in .env.")
        print("Skipping Cloudinary upload step. Local static references will be used.")
        sys.exit(0)

    cloudinary.config(
        cloud_name=cloud_name,
        api_key=api_key,
        api_secret=api_secret,
        secure=True
    )
    
    # Establish local input directories based on target employee folder structure
    employee_output_dir = os.path.join(base_dir, 'output', slug_name)
    
    # Map out files to ingest and prefix-rename for cloud target location mapping
    target_assets = {
        "circle": "avatar_circle_animated.gif",
        "para": "avatar_para_animated.gif",
        "strips": "avatar_strips_animated.gif"
    }
    
    uploaded_manifest = {}
    cdn_folder_path = "email-signatures"
    
    print(f"☁️ Syncing assets to Cloudinary under namespace prefix: '{slug_name}_'")
    
    # 3. Synchronously push tracked image components
    for asset_key, filename in target_assets.items():
        local_file_path = os.path.join(employee_output_dir, filename)
        
        # Fallback check for circle format if placed in root output by alternative builders
        if asset_key == "circle" and not os.path.exists(local_file_path):
            local_file_path = os.path.join(base_dir, 'output', 'avatar_animated.gif')
            
        if not os.path.exists(local_file_path):
            print(f"⚠️ Missing file asset reference skipped: {local_file_path}")
            continue
            
        # Enforce name prefix configuration inside target Public ID string
        target_public_id = f"{slug_name}_avatar_{asset_key}"
        
        try:
            # Append a timestamp to the public_id on every upload so each run
            # creates a brand-new Cloudinary asset with a fresh URL.
            # This avoids needing overwrite/update permissions (which are blocked
            # on unsigned presets) and guarantees the latest photo is always served.
            import time
            versioned_public_id = f"{target_public_id}_{int(time.time())}"

            upload_response = cloudinary.uploader.unsigned_upload(
                local_file_path,
                upload_preset="email_sig_unsigned",
                folder=cdn_folder_path,
                public_id=versioned_public_id,
                resource_type="image"
            )
            
            # Record the fresh versioned URL
            uploaded_manifest[asset_key] = upload_response.get("secure_url")
            print(f"   ✅ Synchronized: {filename} -> {upload_response.get('secure_url')}")

            
        except Exception as upload_error:
            err_msg = str(upload_error)
            print(f"   ⚠️ Upload failed for asset item '{filename}': {err_msg}")
            sys.exit(1)
            
    # 3b. Upload the user's own logo, if one was staged for this run
    logo_url = None
    staged_logo_path = os.path.join(base_dir, 'src', 'assets', 'staging', slug_name, 'logo.png')
    if os.path.exists(staged_logo_path):
        try:
            import time
            logo_public_id = f"{slug_name}_logo_{int(time.time())}"
            logo_response = cloudinary.uploader.unsigned_upload(
                staged_logo_path,
                upload_preset="email_sig_unsigned",
                folder=cdn_folder_path,
                public_id=logo_public_id,
                resource_type="image"
            )
            logo_url = logo_response.get("secure_url")
            print(f"   ✅ Synchronized: logo.png -> {logo_url}")
        except Exception as upload_error:
            print(f"   ⚠️ Logo upload failed: {upload_error}")

    # 4. Handle persistent metadata mapping updates
    config_json_path = os.path.join(base_dir, 'config.json')
    if os.path.exists(config_json_path):
        with open(config_json_path, 'r') as cf:
            config_state = json.load(cf)

        # Ensure cdn URLs registry tracking node blocks are completely allocated
        if "assets" not in config_state:
            config_state["assets"] = {}

        # Store individual references directly to verify template compiler visibility
        config_state["assets"][f"{slug_name}_urls"] = uploaded_manifest
        if logo_url:
            config_state["assets"]["logo_url"] = logo_url

        with open(config_json_path, 'w') as cf:
            json.dump(config_state, cf, indent=2)
            
    print(f"🎉 Cloudinary synchronized deployment completely successful for namespace identifier: {slug_name}")

if __name__ == "__main__":
    run_asset_sync()
