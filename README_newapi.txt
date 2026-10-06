راهنمای تنظیم NewAPI Channel در سرور

برای فعال‌سازی سرویس newapi_channel_conn، متغیرهای زیر را به فایل .env خود اضافه کنید:

1. کلید API (جایگزین با کلید واقعی خودتان):
NEWAPI_CHANNEL_CONN_API_KEY=your_actual_api_key_here

2. آدرس پایه (Base URL):
آدرس API ارائه‌دهنده‌تان را اینجا وارد کنید. 
مثال برای آدرس‌های استاندارد:
NEWAPI_CHANNEL_CONN_BASE_URL=https://your-provider-url.com/v1

3. نام مدل:
نام مدلی که می‌خواهید استفاده کنید را وارد کنید:
NEWAPI_CHANNEL_CONN_MODEL=gpt-4o

نکته: پس از اضافه کردن این مقادیر، سرور را ریستارت کنید.
