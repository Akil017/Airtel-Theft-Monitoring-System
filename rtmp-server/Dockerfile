FROM tiangolo/nginx-rtmp

# Copy nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Create HLS directory
RUN mkdir -p /tmp/hls

EXPOSE 1935 8080

CMD ["nginx", "-g", "daemon off;"]
