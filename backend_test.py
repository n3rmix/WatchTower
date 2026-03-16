import requests
import sys
from datetime import datetime

class ConflictAPITester:
    def __init__(self, base_url="https://war-analytics.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0

    def run_test(self, name, method, endpoint, expected_status, data=None):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                
                # Try to parse JSON response
                try:
                    json_data = response.json()
                    if isinstance(json_data, list):
                        print(f"   📊 Response: List with {len(json_data)} items")
                    elif isinstance(json_data, dict):
                        print(f"   📊 Response keys: {list(json_data.keys())}")
                    return True, json_data
                except:
                    print(f"   ⚠️ Non-JSON response")
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Error: {response.text[:200]}")
                return False, {}

        except requests.exceptions.Timeout:
            print(f"❌ Failed - Request timed out (10s)")
            return False, {}
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_basic_api(self):
        """Test basic API health"""
        return self.run_test("API Health Check", "GET", "", 200)

    def test_conflicts_endpoint(self):
        """Test conflicts endpoint"""
        success, data = self.run_test("Get Conflicts", "GET", "conflicts", 200)
        if success and data:
            print(f"   📊 Found {len(data)} conflicts")
            if data:
                conflict = data[0]
                required_fields = ['country', 'total_deaths', 'civilian_deaths', 'military_deaths', 'children_deaths']
                for field in required_fields:
                    if field in conflict:
                        print(f"   ✓ Has {field}: {conflict[field]}")
                    else:
                        print(f"   ❌ Missing {field}")
        return success

    def test_news_endpoint(self):
        """Test news endpoint"""
        success, data = self.run_test("Get News", "GET", "news", 200)
        if success and data:
            print(f"   📊 Found {len(data)} news articles")
            if data:
                article = data[0]
                required_fields = ['title', 'source', 'url']
                for field in required_fields:
                    if field in article:
                        print(f"   ✓ Has {field}: {article[field][:50]}...")
                    else:
                        print(f"   ❌ Missing {field}")
        return success

    def test_stats_endpoint(self):
        """Test stats endpoint"""
        success, data = self.run_test("Get Stats", "GET", "stats", 200)
        if success and data:
            required_fields = ['total_deaths', 'civilian_deaths', 'military_deaths', 'children_deaths', 'active_conflicts']
            for field in required_fields:
                if field in data:
                    print(f"   ✓ {field}: {data[field]:,}")
                else:
                    print(f"   ❌ Missing {field}")
        return success

    def test_manual_refresh(self):
        """Test manual refresh endpoint"""
        return self.run_test("Manual Refresh", "POST", "refresh", 200)

    def test_api_keys_get(self):
        """Test getting API keys"""
        return self.run_test("Get API Keys", "GET", "settings/api-keys", 200)

    def test_api_keys_post(self):
        """Test saving API key"""
        test_key_data = {
            "service_name": "TestService",
            "api_key": "test_key_12345"
        }
        return self.run_test("Save API Key", "POST", "settings/api-keys", 200, test_key_data)

def main():
    print("🚀 Starting Conflict-as-a-Service API Tests")
    print("=" * 50)
    
    tester = ConflictAPITester()

    # Run all tests
    test_results = []
    
    print("\n📡 Testing Core API Endpoints:")
    test_results.append(tester.test_basic_api())
    test_results.append(tester.test_conflicts_endpoint())
    test_results.append(tester.test_news_endpoint())
    test_results.append(tester.test_stats_endpoint())
    
    print("\n⚙️ Testing Utility Endpoints:")
    test_results.append(tester.test_manual_refresh())
    test_results.append(tester.test_api_keys_get())
    test_results.append(tester.test_api_keys_post())

    # Print final results
    print("\n" + "=" * 50)
    print(f"📊 FINAL RESULTS:")
    print(f"   Tests Run: {tester.tests_run}")
    print(f"   Tests Passed: {tester.tests_passed}")
    print(f"   Success Rate: {(tester.tests_passed/tester.tests_run*100):.1f}%")
    
    if tester.tests_passed == tester.tests_run:
        print("✅ All tests passed!")
        return 0
    else:
        print(f"❌ {tester.tests_run - tester.tests_passed} tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())