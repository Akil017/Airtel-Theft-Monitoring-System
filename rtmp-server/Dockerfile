FROM tiangolo/nginx-rtmp
COPY nginx.conf /etc/nginx/nginx.conf
RUN mkdir -p /tmp/hls /app/static
COPY static/player.html /app/static/player.html
EXPOSE 1935 8080
CMD ["nginx", "-g", "daemon off;"]
