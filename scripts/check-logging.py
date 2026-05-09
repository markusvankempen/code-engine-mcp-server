#!/usr/bin/env python3
"""
Script to check and configure IBM Cloud Logging for a Code Engine project.
"""
import json
import sys
import urllib.request
import urllib.parse
import urllib.error

API_KEY = "YOUR_IBMCLOUD_API_KEY"
REGION = "ca-tor"
PROJECT_ID = "YOUR_CE_PROJECT_ID"
ACCOUNT_ID = "YOUR_IBMCLOUD_ACCOUNT_ID"

def get_token():
    url = "https://iam.cloud.ibm.com/identity/token"
    data = urllib.parse.urlencode({
        "grant_type": "urn:ibm:params:oauth:grant-type:apikey",
        "apikey": API_KEY
    }).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req) as resp:
        d = json.loads(resp.read())
        return d["access_token"]

def api_get(url, token):
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read()), resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {"error": body, "status": e.code}, e.code

def api_post(url, token, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read()), resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {"error": body, "status": e.code}, e.code

print("=== IBM Cloud Logging Check for Code Engine ===")
print()

# Step 1: Get IAM token
print("1. Getting IAM token...")
try:
    token = get_token()
    print(f"   Token obtained: {token[:20]}...")
except Exception as e:
    print(f"   FAILED: {e}")
    sys.exit(1)

# Step 2: Find IBM Cloud Logging instances (new IBM Cloud Logs service)
# Resource ID for IBM Cloud Logs: logs.logdna.0.iam.grnlp (new) or IBM Log Analysis: logdna.logdna (old)
print()
print("2. Checking for IBM Cloud Logs instances (new service)...")
rc_url = f"https://resource-controller.cloud.ibm.com/v2/resource_instances?resource_id=logs.logdna.0&limit=100"
result, status = api_get(rc_url, token)
if status == 200:
    instances = result.get("resources", [])
    print(f"   Found {len(instances)} IBM Cloud Logs instances")
    for inst in instances:
        print(f"   - {inst.get('name')} | crn={inst.get('crn','?')[:60]}... | region={inst.get('region_id')} | state={inst.get('state')}")
else:
    print(f"   Error: {status} - {str(result)[:200]}")

# Step 3: Find IBM Log Analysis instances (old service)
print()
print("3. Checking for IBM Log Analysis instances (old service)...")
rc_url2 = f"https://resource-controller.cloud.ibm.com/v2/resource_instances?resource_id=logdna.logdna&limit=100"
result2, status2 = api_get(rc_url2, token)
if status2 == 200:
    instances2 = result2.get("resources", [])
    print(f"   Found {len(instances2)} IBM Log Analysis instances")
    for inst in instances2:
        print(f"   - {inst.get('name')} | crn={inst.get('crn','?')[:80]} | region={inst.get('region_id')} | state={inst.get('state')}")
else:
    print(f"   Error: {status2} - {str(result2)[:200]}")

# Step 4: Check IBM Cloud Logs Router tenants for ca-tor
print()
print("4. Checking IBM Cloud Logs Router tenants (ca-tor)...")
lr_url = f"https://management.{REGION}.logs-router.cloud.ibm.com/v1/tenants"
result3, status3 = api_get(lr_url, token)
if status3 == 200:
    tenants = result3.get("tenants", [])
    print(f"   Found {len(tenants)} tenants")
    for t in tenants:
        print(f"   - id={t.get('id')} | name={t.get('name')}")
        targets = t.get("targets", [])
        for tgt in targets:
            print(f"     target: {tgt.get('name')} | type={tgt.get('log_sink_crn','?')[:40]}")
else:
    print(f"   Error: {status3} - {str(result3)[:500]}")

# Step 5: Check platform logging (old-style IBM Log Analysis platform config)
print()
print("5. Checking platform logging config for ca-tor...")
pl_url = f"https://api.{REGION}.logging.cloud.ibm.com/v1/config/platformlogs"
result4, status4 = api_get(pl_url, token)
print(f"   Status: {status4}")
print(f"   Response: {str(result4)[:300]}")

print()
print("=== Done ===")
