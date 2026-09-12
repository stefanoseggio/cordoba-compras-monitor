"""run_monitor.py - Fetch active Cordoba, Argentina public tenders (licitaciones)
via the "Cordoba Argentina Licitaciones - Tender Delta API" Apify Actor.
"""
import os
from apify_client import ApifyClient


def main() -> None:
    # Reads the token from the environment - never hardcode it.
    client = ApifyClient(os.environ["APIFY_TOKEN"])

    run_input = {
        "maxItems": 100,
        "onlyNew": True,
        "eventTypes": ["NEW_LISTING", "STATUS_CHANGE", "UPDATED", "CLOSED"],
        "dateRange": "7d",
        "proxyConfiguration": {
            "useApifyProxy": True,
            "apifyProxyGroups": ["RESIDENTIAL"],
            "apifyProxyCountry": "AR",
        },
    }

    # .call() starts the run and blocks until it reaches a terminal state.
    run = client.actor("q9jhMgJRSGjyNbXKA").call(run_input=run_input)
    print(f"Run {run['id']} finished with status: {run['status']}")

    # Page through and print every tender record pushed to the dataset.
    for item in client.dataset(run["defaultDatasetId"]).iterate_items():
        print(f"{item['nroCotizacion']} [{item['event_type']}] "
              f"{item['servicioAdministrativo']} - {item['estado']}")


if __name__ == "__main__":
    main()
