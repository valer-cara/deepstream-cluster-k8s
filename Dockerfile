FROM node:8-alpine

WORKDIR /app

RUN apk update && \
    apk add git python g++ make

ADD package.json package-lock.json ./

RUN npm install

ADD . .

CMD ["./bin/deepstream"]
