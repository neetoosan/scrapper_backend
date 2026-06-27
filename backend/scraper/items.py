"""
Scrapy Item definitions for scraped contact data.
"""

import scrapy


class ContactItem(scrapy.Item):
    """
    Common data model for scraped contacts/businesses.
    Mirrors the JavaScript listing object structure.
    """
    name = scrapy.Field()
    company_name = scrapy.Field()
    phone_numbers = scrapy.Field()          # list[str]
    whatsapp_numbers = scrapy.Field()       # list[str]
    social_media_handles = scrapy.Field()   # list[str]
    emails = scrapy.Field()                 # list[str]
    website = scrapy.Field()                # str
    address = scrapy.Field()                # str
    category = scrapy.Field()               # str
    rating = scrapy.Field()                 # str
    review_count = scrapy.Field()           # str
    source_url = scrapy.Field()             # str
    page_title = scrapy.Field()             # str
